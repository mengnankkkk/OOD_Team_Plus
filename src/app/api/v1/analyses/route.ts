import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createAndRunDataQuery } from "@/server/extensions/query/service";
import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";
import { getDatabase, getRequestContext, idempotencyKey, meta, pageParams } from "@/server/http/context";

const Schema = z.object({
  type: z.enum(["STOCK_DIAGNOSTIC", "PORTFOLIO_DIAGNOSTIC", "HOLDING_REVIEW", "STOCK_SUITABILITY_SCREEN"]),
  conversationId: z.string().optional(),
  input: z.record(z.string(), z.unknown()).default({}),
});

type Row = Record<string, unknown>;

export async function GET(req: NextRequest) {
  const { userId } = getRequestContext(req);
  const { limit, cursor } = pageParams(req);
  const statusFilter = req.nextUrl.searchParams.get("status")?.trim().toLowerCase() ?? "";
  const db = getDatabase();
  const cursorRow = cursor
    ? db.prepare("SELECT created_at,id FROM agent_runs WHERE id=? AND user_id=? AND (root_run_id IS NULL OR root_run_id=id)").get(cursor, userId) as Row | undefined
    : undefined;
  const conditions = ["ar.user_id=?", "(ar.root_run_id IS NULL OR ar.root_run_id=ar.id)"];
  const parameters: unknown[] = [userId];
  if (statusFilter) {
    conditions.push("LOWER(ar.status)=?");
    parameters.push(statusFilter);
  }
  if (cursorRow) {
    conditions.push("(ar.created_at < ? OR (ar.created_at = ? AND ar.id < ?))");
    parameters.push(cursorRow.created_at, cursorRow.created_at, cursorRow.id);
  }
  const rows = db.prepare(`SELECT ar.*,
      (SELECT r.id FROM recommendations r WHERE r.analysis_id=ar.id AND r.user_id=ar.user_id ORDER BY r.created_at DESC,r.id DESC LIMIT 1) AS recommendation_id,
      (SELECT r.status FROM recommendations r WHERE r.analysis_id=ar.id AND r.user_id=ar.user_id ORDER BY r.created_at DESC,r.id DESC LIMIT 1) AS recommendation_status,
      (SELECT COUNT(*) FROM evidence_items ei JOIN agent_runs child ON child.id=ei.agent_run_id
        WHERE ei.user_id=ar.user_id AND (child.id=ar.id OR child.root_run_id=ar.id)) AS evidence_count,
      (SELECT COUNT(*) FROM evidence_items ei JOIN agent_runs child ON child.id=ei.agent_run_id
        WHERE ei.user_id=ar.user_id AND (child.id=ar.id OR child.root_run_id=ar.id) AND LOWER(ei.stance)='missing') AS missing_evidence_count,
      (SELECT COUNT(*) FROM tool_calls tc JOIN agent_runs child ON child.id=tc.agent_run_id
        WHERE child.user_id=ar.user_id AND (child.id=ar.id OR child.root_run_id=ar.id)) AS tool_count,
      (SELECT COUNT(*) FROM skill_runs sr JOIN agent_runs child ON child.id=sr.agent_run_id
        WHERE child.user_id=ar.user_id AND (child.id=ar.id OR child.root_run_id=ar.id)) AS skill_count
    FROM agent_runs ar
    WHERE ${conditions.join(" AND ")}
    ORDER BY ar.created_at DESC,ar.id DESC
    LIMIT ?`).all(...parameters, limit + 1) as Row[];
  db.close();

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return NextResponse.json({
    data: {
      items: page.map(formatAnalysisHistoryItem),
    },
    meta: meta({
      pagination: {
        limit,
        nextCursor: hasMore ? String(page.at(-1)?.id ?? "") || null : null,
        hasMore,
      },
    }),
  });
}

export async function POST(req: NextRequest) {
  const key = idempotencyKey(req);
  if (!key) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } }, { status: 400 });
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid analysis request", details: parsed.error.format() } }, { status: 422 });
  const { userId } = getRequestContext(req);
  const idem = await beginIdempotentRequest(userId, "analysis_create", key, parsed.data);
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  try {
    const question = String(parsed.data.input.question ?? (parsed.data.type === "PORTFOLIO_DIAGNOSTIC" ? "分析当前组合健康度和风险度" : "分析当前持仓指标和风险"));
    const query = await createAndRunDataQuery({ userId, sessionId: parsed.data.conversationId, questionText: question, requestedDatasets: ["PORTFOLIO_HOLDINGS", "PORTFOLIO_METRICS"], outputMode: "SQL_ONLY", requestedLimit: 2000 });
    const payload = { data: { id: query.analysisId, analysisId: query.analysisId, type: parsed.data.type, status: "COMPLETED", result: { dataQueryId: query.queryId, rowCount: query.result.rowCount }, streamUrl: `/api/v1/analyses/${query.analysisId}/events` }, meta: meta() };
    await saveIdempotentResponse(userId, "analysis_create", key, idem.requestHash, payload);
    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: { code: "ANALYSIS_FAILED", message: error instanceof Error ? error.message : "Analysis failed", retryable: false } }, { status: 422 });
  }
}

function formatAnalysisHistoryItem(row: Row) {
  const status = String(row.status ?? "unknown").toUpperCase();
  return {
    id: String(row.id),
    analysisId: String(row.id),
    type: String(row.type ?? "analysis").toUpperCase(),
    status,
    agent: row.agent_type == null ? null : String(row.agent_type).toUpperCase(),
    summary: row.output_summary ?? row.objective ?? row.input_summary ?? null,
    recommendationId: row.recommendation_id ?? null,
    recommendationStatus: row.recommendation_status == null ? null : String(row.recommendation_status).toUpperCase(),
    evidenceCount: Number(row.evidence_count ?? 0),
    missingEvidenceCount: Number(row.missing_evidence_count ?? 0),
    toolCount: Number(row.tool_count ?? 0),
    skillCount: Number(row.skill_count ?? 0),
    canRetry: status === "FAILED" || status === "INTERRUPTED",
    failure: row.failure_code || row.failure_message
      ? { code: row.failure_code ?? null, message: row.failure_message ?? null }
      : null,
    createdAt: row.created_at,
    startedAt: row.started_at ?? row.created_at,
    completedAt: row.completed_at ?? null,
  };
}
