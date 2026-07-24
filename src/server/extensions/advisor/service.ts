import { createArtifact } from "@/server/extensions/artifacts/service";
import { persistSseEvent } from "@/server/extensions/sse/event-persister";
import { createId, getDatabase, isoNow, json, parseJson } from "@/server/http/context";
import { createClarification } from "./clarification-service";
import { runProfessionalAdvisor } from "./professional";

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
    const professional = await runProfessionalAdvisor({
      userId: input.userId,
      sessionId: input.sessionId,
      analysisId,
      content: input.content,
    });
    const missingQuestions = clarificationQuestions(professional.missingInformation);
    const waitingForUser = professional.status === "BLOCKED" && missingQuestions.length > 0;
    return completeRun({
      ...input,
      analysisId,
      userMessageId,
      outputMode,
      answer: waitingForUser ? formatClarificationAnswer(missingQuestions) : professional.answer,
      status: waitingForUser ? "waiting_for_user" : professional.status === "BLOCKED" ? "blocked" : "completed",
      provider: professional.provider,
      missingQuestions,
      recommendation: waitingForUser ? null : professional.recommendation,
      recommendationStatus: professional.status,
      artifactRows: context.holdings.map((holding) => ({
        symbol: holding.symbol,
        name: holding.name,
        marketValue: holding.market_value_decimal,
        unrealizedPnl: holding.unrealized_pnl_decimal,
        weightPercent: holding.weight_bps,
      })),
    });
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

function completeRun(input: AdvisorRunInput & { analysisId: string; userMessageId: string; outputMode: ConversationOutputMode; answer: string; status: "completed" | "waiting_for_user" | "blocked"; provider: string; missingQuestions: string[]; recommendation: RecommendationDraft | null; recommendationStatus: "ACTIVE" | "DEGRADED" | "BLOCKED"; artifactRows: Record<string, unknown>[]; artifactColumns?: Array<{ name: string; type?: string }>; sourceQueryId?: string }) {
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
  const compliance = input.recommendation?.compliance ?? { status: input.recommendationStatus, reasons: input.missingQuestions, disclaimer: defaultDisclaimer() };
  const db = getDatabase();
  const clarificationId = input.status === "waiting_for_user" ? createClarification(db, input) : null;
  if (clarificationId) result.clarificationId = clarificationId;
  const persist = db.transaction(() => {
    db.prepare("INSERT INTO messages (id,session_id,role,content,created_at,agent_run_id,metadata_json) VALUES (?,?,?,?,?,?,?)").run(assistantMessageId, input.sessionId, "assistant", input.answer, now, input.analysisId, json({ provider: input.provider, recommendationId, outputMode: input.outputMode, compliance }));
    if (input.recommendation && recommendationId) persistRecommendation(db, input.userId, input.sessionId, input.analysisId, recommendationId, input.recommendation, input.recommendationStatus, now);
    db.prepare("UPDATE agent_runs SET status=?, completed_at=?, result_json=?, compliance_json=? WHERE id=? AND user_id=?").run(input.status, input.status === "waiting_for_user" ? null : now, json(result), json(compliance), input.analysisId, input.userId);
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
  if (input.status === "blocked") persistSseEvent({ analysisId: input.analysisId, type: "agent.completed", payload: { assistantMessageId, recommendationId, provider: input.provider, status: "BLOCKED" } });
  return result;
}

function persistRecommendation(db: ReturnType<typeof getDatabase>, userId: string, sessionId: string, analysisId: string, recommendationId: string, draft: RecommendationDraft, status: "ACTIVE" | "DEGRADED" | "BLOCKED", now: string) {
  db.prepare(`INSERT INTO recommendations
    (id,user_id,conversation_id,analysis_id,instrument_id,action,suitability,summary,confidence_decimal,position_range_json,first_position,add_conditions_json,reference_range_json,stop_loss,take_profit,horizon,expires_at,reasons_json,counter_evidence_json,risks_json,alternatives_json,invalidation,compliance_json,data_as_of,provenance_json,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,
            ?,?,?,?,?,?,?,
            ?,?,?,?,?,?,?,
            ?,?,?,?,?,?,?)`).run(
    recommendationId, userId, sessionId, analysisId, draft.instrumentId, draft.action, draft.suitability, draft.summary, draft.confidence,
    json(draft.positionRange), draft.firstPosition, json(draft.addConditions), json(draft.referenceRange), draft.stopLoss, draft.takeProfit,
    draft.horizon, draft.expiresAt, json(draft.reasons), json(draft.counterEvidence), json(draft.risks), json(draft.alternatives), draft.invalidation,
    json(draft.compliance), draft.dataAsOf, json(draft.provenance), status, now, now,
  );
  db.prepare(`UPDATE evidence_items SET recommendation_id=?
    WHERE user_id=? AND agent_run_id IN (SELECT id FROM agent_runs WHERE id=? OR root_run_id=?)`)
    .run(recommendationId, userId, analysisId, analysisId);
}

function clarificationQuestions(missing: string[]): string[] {
  const prompts: Record<string, string> = {
    risk_level: "你能接受的风险等级是稳健、平衡还是进取？",
    investment_amount: "这次计划投入多少资金？",
    horizon: "计划持有多久：短线、中线还是长线？",
    max_drawdown: "最大可以接受多少回撤？",
    instrument_preference: "更偏好个股、行业 ETF 还是宽基指数？",
    near_term_use: "这笔钱近期是否需要使用？",
    instrument: "请说明要分析的股票、基金或指数代码。",
    target_holding: "请先录入该标的当前持仓、成本和数量。",
    holdings: "请先录入当前持仓、成本和数量。",
  };
  return [...new Set(missing.flatMap((key) => prompts[key] ? [prompts[key]] : []))];
}

function formatClarificationAnswer(questions: string[]): string {
  return `在给出交易倾向前还缺少关键信息：\n${questions.map((question) => `- ${question}`).join("\n")}`;
}

function normalizeOutputMode(value: string | undefined): ConversationOutputMode {
  const normalized = value?.toUpperCase();
  return normalized === "CHART" || normalized === "FINANCIAL_REPORT" ? normalized : "SQL_ONLY";
}

function defaultDisclaimer(): string {
  return "本结果用于投资研究和方案模拟，不构成收益承诺，不会创建真实订单，最终决策由用户自行作出。";
}
