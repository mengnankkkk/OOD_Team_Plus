import { NextRequest, NextResponse } from "next/server";

import { refreshPortfolio } from "@/server/extensions/analysis/service";
import { runConversationAgent } from "@/server/extensions/advisor/service";
import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";
import { createAndRunDataQuery } from "@/server/extensions/query/service";
import { syncRssFeed } from "@/server/extensions/rss/service";
import { runResearchSearch, type ResearchAdapter } from "@/server/extensions/search/service";
import { generateOptions } from "@/server/extensions/simulation/service";
import { getDatabase, getRequestContext, idempotencyKey, meta, parseJson } from "@/server/http/context";

type Row = Record<string, unknown>;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const key = idempotencyKey(req);
  if (!key) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } }, { status: 400 });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const { userId } = getRequestContext(req);
  const routeCode = `analysis_retry:${id}`;
  const idem = await beginIdempotentRequest(userId, routeCode, key, body);
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  const db = getDatabase();
  const source = db.prepare("SELECT * FROM agent_runs WHERE id=? AND user_id=? AND status IN ('failed','interrupted')").get(id, userId) as Row | undefined;
  db.close();
  if (!source) return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Analysis not found" } }, { status: 404 });
  try {
    const retried = await retryAnalysis(userId, id, source, body);
    const payload = {
      data: {
        retryAnalysisId: retried.analysisId,
        analysisId: retried.analysisId,
        retryOf: id,
        type: String(source.type).toUpperCase(),
        status: "COMPLETED",
        streamUrl: `/api/v1/analyses/${retried.analysisId}/events`,
        result: retried.result,
      },
      meta: meta(),
    };
    await saveIdempotentResponse(userId, routeCode, key, idem.requestHash, payload);
    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis retry failed";
    const status = message === "ANALYSIS_RETRY_UNSUPPORTED" ? 409 : message.includes("not found") ? 404 : 422;
    return NextResponse.json({ error: { code: status === 409 ? message : status === 404 ? "RESOURCE_NOT_FOUND" : "ANALYSIS_RETRY_FAILED", message, retryable: status >= 500 } }, { status });
  }
}

async function retryAnalysis(userId: string, sourceId: string, source: Row, overrides: Record<string, unknown>) {
  const type = String(source.type);
  if (type === "data_query") {
    const db = getDatabase();
    const query = db.prepare("SELECT * FROM data_queries WHERE agent_run_id=? AND user_id=?").get(sourceId, userId) as Row | undefined;
    db.close();
    if (!query) throw new Error("Data query not found");
    const outputMode = String(query.output_mode).toUpperCase();
    const result = await createAndRunDataQuery({
      userId,
      sessionId: query.session_id ? String(query.session_id) : undefined,
      sourceMessageId: query.source_message_id ? String(query.source_message_id) : undefined,
      questionText: String(query.question_text),
      requestedDatasets: parseJson(String(query.requested_datasets_json), []),
      outputMode: outputMode === "CHART" || outputMode === "FINANCIAL_REPORT" ? outputMode : "SQL_ONLY",
      requestedLimit: Number(query.requested_limit),
      accountScope: parseJson(String(query.account_scope_json ?? "[]"), []),
    });
    return { analysisId: result.analysisId, result: { dataQueryId: result.queryId, rowCount: result.result.rowCount } };
  }
  if (type === "conversation_agent") {
    const db = getDatabase();
    const message = db.prepare(`SELECT m.session_id,m.content FROM messages m JOIN conversation_sessions c ON c.id=m.session_id
      WHERE m.agent_run_id=? AND m.role='user' AND c.user_id=? ORDER BY m.created_at LIMIT 1`).get(sourceId, userId) as { session_id?: string; content?: string } | undefined;
    db.close();
    if (!message?.session_id || !message.content) throw new Error("Conversation message not found");
    const result = await runConversationAgent({ userId, sessionId: message.session_id, content: message.content, clientMessageId: `retry:${sourceId}:${crypto.randomUUID()}` });
    const analysis = (result as { analysis?: { analysisId?: string } }).analysis;
    if (!analysis?.analysisId) throw new Error("Conversation retry did not create an analysis");
    return { analysisId: analysis.analysisId, result };
  }
  if (type === "portfolio_refresh") {
    const db = getDatabase();
    const portfolio = db.prepare("SELECT portfolio_id FROM portfolio_snapshots WHERE user_id=? ORDER BY created_at DESC LIMIT 1").get(userId) as { portfolio_id?: string } | undefined;
    db.close();
    const portfolioId = typeof overrides.portfolioId === "string" ? overrides.portfolioId : portfolio?.portfolio_id;
    if (!portfolioId) throw new Error("Portfolio not found");
    const result = await refreshPortfolio(userId, portfolioId);
    return { analysisId: result.analysisId, result: { portfolioSnapshotId: result.snapshotId, dataQuality: result.dataQuality } };
  }
  if (type === "rss_sync") {
    const sourceResult = parseJson<Record<string, unknown>>(String(source.result_json ?? "{}"), {});
    const feedId = typeof overrides.feedId === "string" ? overrides.feedId : sourceResult.feedId;
    if (typeof feedId !== "string") throw new Error("RSS feed not found");
    const result = await syncRssFeed(feedId, userId, { force: true });
    return { analysisId: result.analysisId, result };
  }
  if (type === "branch_option_generation") {
    const db = getDatabase();
    const batch = db.prepare(`SELECT b.workspace_id,w.objective_text FROM simulation_option_batches b
      JOIN simulation_workspaces w ON w.id=b.workspace_id WHERE b.agent_run_id=? AND w.user_id=?`).get(sourceId, userId) as { workspace_id?: string; objective_text?: string } | undefined;
    db.close();
    if (!batch?.workspace_id) throw new Error("Simulation workspace not found");
    const objective = typeof overrides.objective === "string" ? overrides.objective : batch.objective_text ?? "重新生成分支候选";
    const result = await generateOptions(userId, batch.workspace_id, objective);
    return { analysisId: result.analysisId, result: { batchId: result.batchId, optionCount: result.candidates.length } };
  }
  if (type === "research_search") {
    const sourceResult = parseJson<Record<string, unknown>>(String(source.result_json ?? "{}"), {});
    const db = getDatabase();
    const search = typeof sourceResult.searchId === "string"
      ? db.prepare("SELECT * FROM research_searches WHERE id=? AND user_id=?").get(sourceResult.searchId, userId) as Row | undefined
      : db.prepare("SELECT * FROM research_searches WHERE user_id=? AND created_at=? ORDER BY created_at DESC LIMIT 1").get(userId, source.created_at) as Row | undefined;
    db.close();
    if (!search) throw new Error("Research search not found");
    const adapters = parseJson<ResearchAdapter[]>(String(search.adapters_json), ["KNOWLEDGE_BASE", "MCP"]);
    const result = await runResearchSearch({ userId, query: String(search.query_text), adapters, maximumResults: typeof overrides.maximumResults === "number" ? overrides.maximumResults : 10 });
    return { analysisId: result.analysisId, result: { searchId: result.searchId, resultCount: result.resultCount, sourceStatuses: result.sourceStatuses } };
  }
  throw new Error("ANALYSIS_RETRY_UNSUPPORTED");
}
