import { RequestContext } from "@mastra/core/request-context";

import { supervisorAgent } from "@/mastra";
import { createArtifact } from "@/server/extensions/artifacts/service";
import { createAndRunDataQuery } from "@/server/extensions/query/service";
import { persistSseEvent } from "@/server/extensions/sse/event-persister";
import { createId, getDatabase, isoNow, json, parseJson } from "@/server/http/context";
import { createClarification } from "./clarification-service";

import {
  buildDeterministicAnswer,
  buildRecommendation,
  classifyIntent,
  defaultDisclaimer,
  missingProfileQuestions,
  normalizeOutputMode,
  selectTarget,
} from "./decision-engine";
import type {
  AdvisorContext,
  AdvisorHolding,
  AdvisorInstrument,
  AdvisorRunInput,
  ConversationOutputMode,
  ProfileRow,
  RecommendationDraft,
} from "./types";

export type { ConversationOutputMode } from "./types";

export async function runConversationAgent(input: AdvisorRunInput) {
  const prepared = prepareRun(input);
  if (prepared.replayed) return prepared.result;
  const { analysisId, userMessageId, outputMode } = prepared;
  persistSseEvent({ analysisId, type: "agent.started", payload: { type: "CONVERSATION_AGENT", conversationId: input.sessionId, outputMode } });

  try {
    const context = loadAdvisorContext(input.userId);
    const missingQuestions = missingProfileQuestions(context.profile);
    const intent = classifyIntent(input.content);
    const target = selectTarget(input.content, context);
    const requiresProfile = intent === "BUY" || intent === "SELL";
    const requiresHolding = intent === "SELL" || intent === "DIAGNOSIS";
    const blockedQuestions = [
      ...(requiresProfile ? missingQuestions : []),
      ...(requiresHolding && context.holdings.length === 0 ? ["请先录入当前持仓、成本和数量。"] : []),
      ...((intent === "BUY" || intent === "SELL") && !target ? ["请说明要分析的股票、基金或指数代码。"] : []),
    ];

    if (blockedQuestions.length) {
      const answer = `在给出交易倾向前还缺少关键信息：\n${blockedQuestions.map((question) => `- ${question}`).join("\n")}`;
      return completeRun({ ...input, analysisId, userMessageId, outputMode, answer, status: "waiting_for_user", provider: "RULE_ENGINE", missingQuestions: blockedQuestions, recommendation: null, artifactRows: [] });
    }

    if (intent === "QUERY") {
      const query = await createAndRunDataQuery({
        userId: input.userId,
        sessionId: input.sessionId,
        sourceMessageId: userMessageId,
        questionText: input.content,
        requestedDatasets: queryDatasets(input.content),
        outputMode,
        requestedLimit: 2_000,
      });
      const answer = formatQueryAnswer(query.result.columns, query.result.rows, query.result.rowCount, query.result.isTruncated);
      return completeRun({
        ...input,
        analysisId,
        userMessageId,
        outputMode,
        answer,
        status: "completed",
        provider: "SAFE_QUERY",
        missingQuestions: [],
        recommendation: null,
        artifactRows: query.result.rows,
        artifactColumns: query.result.columns,
        sourceQueryId: query.queryId,
      });
    }

    const recommendation = target && (intent === "BUY" || intent === "SELL")
      ? buildRecommendation(intent, target, context)
      : null;
    const deterministicAnswer = buildDeterministicAnswer(intent, context, recommendation);
    const modelResult = await explainWithModel(input, context, recommendation, deterministicAnswer);
    return completeRun({ ...input, analysisId, userMessageId, outputMode, answer: modelResult.answer, status: "completed", provider: modelResult.provider, missingQuestions: [], recommendation, artifactRows: context.holdings.map((holding) => ({ symbol: holding.symbol, name: holding.name, marketValue: Number(holding.market_value_decimal), unrealizedPnl: Number(holding.unrealized_pnl_decimal), weightPercent: Number(holding.weight_bps) / 100 })) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Conversation analysis failed";
    const db = getDatabase();
    db.prepare("UPDATE agent_runs SET status='failed', completed_at=?, failure_code='ADVISOR_RUN_FAILED', failure_message=? WHERE id=? AND user_id=?").run(isoNow(), message, analysisId, input.userId);
    db.close();
    persistSseEvent({ analysisId, type: "agent.failed", payload: { code: "ADVISOR_RUN_FAILED", retryable: true } });
    throw error;
  }
}

function prepareRun(input: AdvisorRunInput) {
  const db = getDatabase();
  const session = db.prepare("SELECT id FROM conversation_sessions WHERE id=? AND user_id=? AND status='active'").get(input.sessionId, input.userId);
  if (!session) {
    db.close();
    throw new Error("Conversation not found");
  }
  if (input.clientMessageId) {
    const prior = db.prepare("SELECT id, agent_run_id FROM messages WHERE session_id=? AND client_message_id=? AND role='user'").get(input.sessionId, input.clientMessageId) as { id?: string; agent_run_id?: string } | undefined;
    if (prior?.agent_run_id) {
      const priorMessage = db.prepare("SELECT content FROM messages WHERE id=?").get(prior.id) as { content?: string } | undefined;
      if (priorMessage?.content !== input.content) {
        db.close();
        throw new Error("IDEMPOTENCY_CONFLICT");
      }
      const run = db.prepare("SELECT result_json FROM agent_runs WHERE id=? AND user_id=?").get(prior.agent_run_id, input.userId) as { result_json?: string } | undefined;
      db.close();
      if (run?.result_json) return { replayed: true as const, result: parseJson(run.result_json, {}) };
      throw new Error("RUN_ALREADY_ACTIVE");
    }
  }
  const preference = db.prepare("SELECT output_mode FROM conversation_output_preferences WHERE session_id=? AND user_id=?").get(input.sessionId, input.userId) as { output_mode?: string } | undefined;
  const outputMode = input.outputMode ?? normalizeOutputMode(preference?.output_mode);
  const now = isoNow();
  const analysisId = createId("analysis");
  const userMessageId = createId("message");
  const create = db.transaction(() => {
    db.prepare("INSERT INTO agent_runs (id,user_id,type,status,created_at) VALUES (?,?,?,?,?)").run(analysisId, input.userId, "conversation_agent", "running", now);
    db.prepare("INSERT INTO messages (id,session_id,role,content,created_at,client_message_id,agent_run_id,metadata_json) VALUES (?,?,?,?,?,?,?,?)").run(userMessageId, input.sessionId, "user", input.content, now, input.clientMessageId ?? null, analysisId, json({ outputMode }));
    db.prepare("UPDATE conversation_sessions SET updated_at=? WHERE id=? AND user_id=?").run(now, input.sessionId, input.userId);
  });
  create();
  db.close();
  return { replayed: false as const, analysisId, userMessageId, outputMode };
}

function loadAdvisorContext(userId: string): AdvisorContext {
  const db = getDatabase();
  const profile = db.prepare("SELECT * FROM user_profiles WHERE user_id=?").get(userId) as ProfileRow | undefined;
  const goals = db.prepare("SELECT * FROM goals WHERE user_id=? AND status='active' ORDER BY created_at DESC").all(userId) as Array<Record<string, unknown>>;
  const snapshot = db.prepare("SELECT * FROM portfolio_snapshots WHERE user_id=? ORDER BY created_at DESC LIMIT 1").get(userId) as Record<string, unknown> | undefined;
  const holdings = snapshot ? db.prepare(`SELECT hs.*, i.symbol, i.name, i.asset_type, i.market, i.sector
    FROM holding_snapshots hs JOIN instruments i ON i.id=hs.instrument_id
    WHERE hs.portfolio_snapshot_id=? ORDER BY hs.weight_bps DESC`).all(snapshot.id) as AdvisorHolding[] : [];
  const instruments = db.prepare(`SELECT i.*,
      (SELECT hs.price_decimal FROM holding_snapshots hs JOIN portfolio_snapshots ps ON ps.id=hs.portfolio_snapshot_id
       WHERE hs.instrument_id=i.id AND ps.user_id=? ORDER BY ps.created_at DESC LIMIT 1) AS latest_price
    FROM instruments i WHERE i.tradable=1 ORDER BY i.symbol`).all(userId) as AdvisorInstrument[];
  db.close();
  return { profile: profile ?? null, goals, snapshot: snapshot ?? null, holdings, instruments };
}

async function explainWithModel(input: AdvisorRunInput, context: AdvisorContext, recommendation: RecommendationDraft | null, fallback: string) {
  if (!process.env.DEEPSEEK_API_KEY?.trim()) return { answer: fallback, provider: "RULE_ENGINE" };
  const requestContext = new RequestContext();
  requestContext.set("userId", input.userId);
  requestContext.set("sessionId", input.sessionId);
  requestContext.set("outputMode", input.outputMode ?? "SQL_ONLY");
  const prompt = [
    "请把下面经过确定性规则和合规检查的结果解释成简洁中文。",
    "不得改变动作、仓位、价格区间、止损止盈、有效期或合规状态；不得承诺收益。",
    `用户问题：${input.content}`,
    `画像：${json({ riskLevel: context.profile?.risk_level ?? null, horizon: context.profile?.horizon ?? null, maxDrawdown: context.profile?.max_drawdown_decimal ?? null })}`,
    `规则结论：${recommendation ? json(recommendation) : fallback}`,
  ].join("\n");
  try {
    const result = await supervisorAgent.generate(prompt, { requestContext, maxSteps: 3, modelSettings: { maxOutputTokens: 500, temperature: 0.1 } });
    return { answer: result.text.trim() || fallback, provider: "DEEPSEEK" };
  } catch {
    return { answer: fallback, provider: "RULE_ENGINE_FALLBACK" };
  }
}

function completeRun(input: AdvisorRunInput & { analysisId: string; userMessageId: string; outputMode: ConversationOutputMode; answer: string; status: "completed" | "waiting_for_user"; provider: string; missingQuestions: string[]; recommendation: RecommendationDraft | null; artifactRows: Record<string, unknown>[]; artifactColumns?: Array<{ name: string; type?: string }>; sourceQueryId?: string }) {
  const now = isoNow();
  const assistantMessageId = createId("message");
  const recommendationId = input.recommendation ? createId("recommendation") : null;
  const result: Record<string, unknown> = {
    messageId: input.userMessageId,
    assistantMessageId,
    analysis: { analysisId: input.analysisId, type: "ADVISORY", status: input.status.toUpperCase(), streamUrl: `/api/v1/analyses/${input.analysisId}/events` },
    outputMode: input.outputMode,
    answer: input.answer,
    recommendationId,
    missingQuestions: input.missingQuestions,
    dataQueryId: input.sourceQueryId ?? null,
  };
  const compliance = input.recommendation?.compliance ?? { status: input.status === "waiting_for_user" ? "BLOCKED" : "PASSED", reasons: input.missingQuestions, disclaimer: defaultDisclaimer() };
  const db = getDatabase();
  const clarificationId = input.status === "waiting_for_user" ? createClarification(db, input) : null;
  if (clarificationId) result.clarificationId = clarificationId;
  const persist = db.transaction(() => {
    db.prepare("INSERT INTO messages (id,session_id,role,content,created_at,agent_run_id,metadata_json) VALUES (?,?,?,?,?,?,?)").run(assistantMessageId, input.sessionId, "assistant", input.answer, now, input.analysisId, json({ provider: input.provider, recommendationId, outputMode: input.outputMode, compliance }));
    if (input.recommendation && recommendationId) persistRecommendation(db, input.userId, input.sessionId, input.analysisId, recommendationId, input.recommendation, now);
    db.prepare("UPDATE agent_runs SET status=?, completed_at=?, result_json=?, compliance_json=? WHERE id=? AND user_id=?").run(input.status, input.status === "completed" ? now : null, json(result), json(compliance), input.analysisId, input.userId);
    db.prepare("UPDATE conversation_sessions SET updated_at=? WHERE id=? AND user_id=?").run(now, input.sessionId, input.userId);
  });
  persist();
  db.close();
  if (input.status === "completed" && input.outputMode !== "SQL_ONLY") {
    const artifact = createArtifact({
      userId: input.userId,
      sessionId: input.sessionId,
      sourceMessageId: assistantMessageId,
      sourceQueryId: input.sourceQueryId,
      artifactType: input.outputMode === "CHART" ? "ECHARTS_OPTION" : "MARKDOWN",
      title: input.outputMode === "CHART" ? "当前持仓分析图表" : "当前持仓财务分析报告",
      sourceRows: input.artifactRows,
      sourceColumns: input.artifactColumns ?? [
        { name: "symbol", type: "string" },
        { name: "marketValue", type: "number" },
        { name: "unrealizedPnl", type: "number" },
        { name: "weightPercent", type: "number" },
      ],
    });
    result.artifact = { artifactId: artifact.artifactId, analysisId: artifact.analysisId, status: artifact.status, previewUrl: `/api/v1/generated-artifacts/${artifact.artifactId}/preview` };
    const resultDb = getDatabase();
    resultDb.prepare("UPDATE agent_runs SET result_json=? WHERE id=? AND user_id=?").run(json(result), input.analysisId, input.userId);
    resultDb.close();
  }
  if (recommendationId) persistSseEvent({ analysisId: input.analysisId, type: "recommendation.created", payload: { recommendationId, status: input.recommendation?.compliance.status } });
  if (input.status === "completed") persistSseEvent({ analysisId: input.analysisId, type: "agent.completed", payload: { assistantMessageId, recommendationId, provider: input.provider } });
  return result;
}

function queryDatasets(content: string): string[] {
  const datasets = ["PORTFOLIO_HOLDINGS"];
  if (/(健康|风险|评分|指标|回撤|波动|集中度)/u.test(content)) datasets.push("PORTFOLIO_METRICS");
  if (/(标的|股票|基金|指数|ETF|代码)/iu.test(content)) datasets.push("INSTRUMENTS");
  return datasets;
}

function formatQueryAnswer(columns: Array<{ name: string; type: string }>, rows: Record<string, unknown>[], rowCount: number, truncated: boolean): string {
  const header = columns.map((column) => column.name).join(" | ");
  const body = rows.slice(0, 20).map((row) => columns.map((column) => String(row[column.name] ?? "")).join(" | ")).join("\n");
  return [`查询完成，共 ${rowCount} 行${truncated ? "（结果已截断）" : ""}。`, header ? `列：${header}` : "", body ? body : "暂无符合条件的数据。"].filter(Boolean).join("\n");
}

function persistRecommendation(db: ReturnType<typeof getDatabase>, userId: string, sessionId: string, analysisId: string, recommendationId: string, draft: RecommendationDraft, now: string) {
  db.prepare(`INSERT INTO recommendations
    (id,user_id,conversation_id,analysis_id,instrument_id,action,suitability,summary,confidence_decimal,position_range_json,first_position,add_conditions_json,reference_range_json,stop_loss,take_profit,horizon,expires_at,reasons_json,counter_evidence_json,risks_json,alternatives_json,invalidation,compliance_json,data_as_of,provenance_json,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?)`).run(
    recommendationId, userId, sessionId, analysisId, draft.instrumentId, draft.action, draft.suitability, draft.summary, draft.confidence,
    json(draft.positionRange), draft.firstPosition, json(draft.addConditions), json(draft.referenceRange), draft.stopLoss, draft.takeProfit,
    draft.horizon, draft.expiresAt, json(draft.reasons), json(draft.counterEvidence), json(draft.risks), json(draft.alternatives), draft.invalidation,
    json(draft.compliance), draft.dataAsOf, json(draft.provenance), now, now,
  );
  const support = draft.reasons.map((summary, index) => ({ kind: "SUPPORT", title: `支持证据 ${index + 1}`, summary }));
  const counter = draft.counterEvidence.map((summary, index) => ({ kind: "COUNTER", title: `反方证据 ${index + 1}`, summary }));
  for (const evidence of [...support, ...counter]) {
    db.prepare("INSERT INTO evidence_items (id,user_id,recommendation_id,kind,title,summary,source,created_at) VALUES (?,?,?,?,?,?,?,?)").run(createId("evidence"), userId, recommendationId, evidence.kind, evidence.title, evidence.summary, "DETERMINISTIC_ADVISOR", now);
  }
}
