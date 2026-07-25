import { createArtifact } from "@/server/extensions/artifacts/service";
import { persistSseEvent } from "@/server/extensions/sse/event-persister";
import { createId, getDatabase, isoNow, json, parseJson } from "@/server/http/context";
import { createClarification } from "./clarification-service";
import { runProfessionalAdvisor, type ProfessionalAdvisorResult } from "./professional";
import type { DebateSuggestion } from "./professional-contracts";

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

type PreparedNewRun = {
  replayed: false;
  analysisId: string;
  userMessageId: string;
  outputMode: ConversationOutputMode;
};

type ConversationAgentResult = {
  messageId: string;
  assistantMessageId?: string;
  analysis: { analysisId: string; type: "ADVISORY"; status: string; streamUrl: string };
  outputMode: ConversationOutputMode;
  answer: string | null;
  recommendationId: string | null;
  missingQuestions: string[];
  conversationKind: "GUIDED_INTAKE" | "FINANCIAL_PLAN" | "DECISION" | null;
  dataQueryId: string | null;
  debateSuggestion: DebateSuggestion | null;
  clarificationId?: string;
  artifact?: { artifactId: string; analysisId: string; status: string; previewUrl: string };
};

export type AdvisorPublicationResult = {
  analysisId: string;
  status: ProfessionalAdvisorResult["status"];
  direction: ProfessionalAdvisorResult["direction"];
  action: ProfessionalAdvisorResult["action"];
  answer: string;
  recommendationId: string | null;
  missingInformation: string[];
  provider: ProfessionalAdvisorResult["provider"];
};

export async function runConversationAgent(input: AdvisorRunInput): Promise<ConversationAgentResult> {
  const prepared = prepareRun(input);
  if (prepared.replayed) return prepared.result;
  return executePreparedConversationAgent(input, prepared);
}

export function startConversationAgent(input: AdvisorRunInput) {
  const prepared = prepareRun(input);
  if (prepared.replayed) return { replayed: true as const, result: prepared.result };
  void executePreparedConversationAgent(input, prepared).catch(() => undefined);
  return {
    replayed: false as const,
    result: {
      messageId: prepared.userMessageId,
      analysis: {
        analysisId: prepared.analysisId,
        type: "ADVISORY",
        status: "RUNNING",
        streamUrl: `/api/v1/analyses/${prepared.analysisId}/events`,
      },
      outputMode: prepared.outputMode,
      answer: null,
      recommendationId: null,
      missingQuestions: [],
      conversationKind: null,
      dataQueryId: null,
      debateSuggestion: null,
    },
  };
}

export async function runAdvisorPublicationGate(input: {
  userId: string;
  sessionId: string;
  rootAnalysisId: string;
  content: string;
  targetSymbol?: string | null;
}): Promise<AdvisorPublicationResult> {
  const analysisId = createId("analysis");
  const now = isoNow();
  const db = getDatabase();
  db.prepare(`INSERT INTO agent_runs
    (id,user_id,type,status,session_id,parent_run_id,root_run_id,agent_type,objective,created_at,started_at)
    VALUES (?,?,'advisor_publication','running',?,?,?,?,?,?,?)`).run(
    analysisId,
    input.userId,
    input.sessionId,
    input.rootAnalysisId,
    input.rootAnalysisId,
    "chief_advisor",
    input.content.slice(0, 500),
    now,
    now,
  );
  db.close();
  persistSseEvent({ analysisId: input.rootAnalysisId, type: "agent.delegated", payload: { agent: "CHIEF_ADVISOR", childRunId: analysisId, publicationGate: true } });

  try {
    const professional = await runProfessionalAdvisor({
      userId: input.userId,
      sessionId: input.sessionId,
      analysisId,
      rootAnalysisId: input.rootAnalysisId,
      content: input.content,
      targetSymbol: input.targetSymbol ?? undefined,
    });
    const recommendationId = professional.recommendation ? createId("recommendation") : null;
    const result: AdvisorPublicationResult = {
      analysisId,
      status: professional.status,
      direction: professional.direction,
      action: professional.action,
      answer: professional.answer,
      recommendationId,
      missingInformation: professional.missingInformation,
      provider: professional.provider,
    };
    const completedAt = isoNow();
    const compliance = professional.recommendation?.compliance ?? {
      status: professional.status,
      reasons: professional.missingInformation,
      disclaimer: defaultDisclaimer(),
    };
    const resultDb = getDatabase();
    try {
      const persist = resultDb.transaction(() => {
        if (professional.recommendation && recommendationId) {
          persistRecommendation(
            resultDb,
            input.userId,
            input.sessionId,
            analysisId,
            recommendationId,
            professional.recommendation,
            professional.status,
            completedAt,
            input.rootAnalysisId,
          );
        }
        resultDb.prepare("UPDATE agent_runs SET status=?,completed_at=?,output_summary=?,result_json=?,compliance_json=? WHERE id=? AND user_id=?")
          .run(professional.status === "BLOCKED" ? "blocked" : "completed", completedAt, professional.answer, json(result), json(compliance), analysisId, input.userId);
      });
      persist();
    } finally {
      resultDb.close();
    }
    if (recommendationId) persistSseEvent({ analysisId: input.rootAnalysisId, type: "recommendation.created", payload: { recommendationId, childRunId: analysisId, publicationGate: true } });
    persistSseEvent({ analysisId: input.rootAnalysisId, type: "agent.completed", payload: { agent: "CHIEF_ADVISOR", childRunId: analysisId, publicationGate: true, status: professional.status, recommendationId } });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chief Advisor publication failed";
    const failedDb = getDatabase();
    failedDb.prepare("UPDATE agent_runs SET status='failed',completed_at=?,failure_code='ADVISOR_PUBLICATION_FAILED',failure_message=? WHERE id=? AND user_id=?")
      .run(isoNow(), message.slice(0, 500), analysisId, input.userId);
    failedDb.close();
    persistSseEvent({ analysisId: input.rootAnalysisId, type: "agent.failed", payload: { agent: "CHIEF_ADVISOR", childRunId: analysisId, publicationGate: true, code: "ADVISOR_PUBLICATION_FAILED" } });
    throw error;
  }
}

async function executePreparedConversationAgent(input: AdvisorRunInput, prepared: PreparedNewRun) {
  const { analysisId, userMessageId, outputMode } = prepared;
  persistSseEvent({
    analysisId,
    type: "agent.started",
    payload: {
      type: "CONVERSATION_AGENT",
      conversationId: input.sessionId,
      outputMode,
      workflow: input.workflow ?? "CONVERSATION",
    },
  });

  try {
    const context = loadAdvisorContext(input.userId);
    const professional = await runProfessionalAdvisor({
      userId: input.userId,
      sessionId: input.sessionId,
      analysisId,
      content: input.content,
      workflow: input.workflow,
    });
    const decisionWorkflow = professional.kind === "DECISION";
    const missingQuestions = input.workflow === "DAILY_PORTFOLIO" || !decisionWorkflow
      ? []
      : clarificationQuestions(professional.missingInformation);
    const waitingForUser = decisionWorkflow && professional.status === "BLOCKED" && missingQuestions.length > 0;
    return completeRun({
      ...input,
      analysisId,
      userMessageId,
      outputMode,
      answer: waitingForUser ? formatClarificationAnswer(missingQuestions) : professional.answer,
      status: waitingForUser ? "waiting_for_user" : "completed",
      provider: professional.provider,
      missingQuestions,
      recommendation: waitingForUser ? null : professional.recommendation,
      recommendationStatus: professional.status,
      debateSuggestion: professional.debateSuggestion,
      conversationKind: professional.kind,
      artifactRows: context.holdings.map((holding) => ({
        symbol: holding.symbol,
        name: holding.name,
        marketValue: holding.market_value_decimal,
        unrealizedPnl: holding.unrealized_pnl_decimal,
        weightPercent: Number(holding.weight_bps) / 100,
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
      if (run?.result_json) return { replayed: true as const, result: parseJson<ConversationAgentResult>(run.result_json, {} as ConversationAgentResult) };
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
    db.prepare("INSERT INTO messages (id,session_id,role,content,created_at,client_message_id,agent_run_id,metadata_json) VALUES (?,?,?,?,?,?,?,?)").run(
      userMessageId,
      input.sessionId,
      "user",
      input.content,
      now,
      input.clientMessageId ?? null,
      analysisId,
      json({ outputMode, workflow: input.workflow ?? "CONVERSATION" }),
    );
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

function completeRun(input: AdvisorRunInput & { analysisId: string; userMessageId: string; outputMode: ConversationOutputMode; answer: string; status: "completed" | "waiting_for_user" | "blocked"; provider: string; missingQuestions: string[]; recommendation: RecommendationDraft | null; recommendationStatus: "ACTIVE" | "DEGRADED" | "BLOCKED"; conversationKind: "GUIDED_INTAKE" | "FINANCIAL_PLAN" | "DECISION"; debateSuggestion: DebateSuggestion; artifactRows: Record<string, unknown>[]; artifactColumns?: Array<{ name: string; type?: string }>; sourceQueryId?: string }): ConversationAgentResult {
  const now = isoNow();
  const assistantMessageId = createId("message");
  const recommendationId = input.recommendation ? createId("recommendation") : null;
  persistAdvisorAnswerStream(input.analysisId, input.answer, input.recommendationStatus, input.conversationKind);
  const result: ConversationAgentResult = {
    messageId: input.userMessageId,
    assistantMessageId,
    analysis: { analysisId: input.analysisId, type: "ADVISORY", status: input.status.toUpperCase(), streamUrl: `/api/v1/analyses/${input.analysisId}/events` },
    outputMode: input.outputMode,
    answer: input.answer,
    recommendationId,
    missingQuestions: input.missingQuestions,
    conversationKind: input.conversationKind,
    dataQueryId: input.sourceQueryId ?? null,
    debateSuggestion: input.debateSuggestion,
  };
  const compliance = input.recommendation?.compliance ?? { status: input.recommendationStatus, reasons: input.missingQuestions, disclaimer: defaultDisclaimer() };
  const db = getDatabase();
  const clarificationId = input.status === "waiting_for_user" ? createClarification(db, input) : null;
  if (clarificationId) result.clarificationId = clarificationId;
  const persist = db.transaction(() => {
    db.prepare("INSERT INTO messages (id,session_id,role,content,created_at,agent_run_id,metadata_json) VALUES (?,?,?,?,?,?,?)").run(
      assistantMessageId,
      input.sessionId,
      "assistant",
      input.answer,
      now,
      input.analysisId,
      json({
        provider: input.provider,
        recommendationId,
        outputMode: input.outputMode,
        conversationKind: input.conversationKind,
        compliance,
        debateSuggestion: input.debateSuggestion,
      }),
    );
    if (input.recommendation && recommendationId) persistRecommendation(db, input.userId, input.sessionId, input.analysisId, recommendationId, input.recommendation, input.recommendationStatus, now);
    db.prepare("UPDATE agent_runs SET status=?, completed_at=?, result_json=?, compliance_json=? WHERE id=? AND user_id=?").run(input.status, input.status === "waiting_for_user" ? null : now, json(result), json(compliance), input.analysisId, input.userId);
    db.prepare("UPDATE conversation_sessions SET updated_at=? WHERE id=? AND user_id=?").run(now, input.sessionId, input.userId);
  });
  persist();
  db.close();
  if ((input.status === "completed" || input.status === "blocked") && input.outputMode !== "SQL_ONLY") {
    const artifactTitle = input.outputMode === "CHART"
      ? "当前持仓分析图表"
      : input.workflow === "DAILY_PORTFOLIO" ? "资产深度报告" : "当前持仓财务分析报告";
    const artifact = createArtifact({
      userId: input.userId,
      sessionId: input.sessionId,
      sourceMessageId: assistantMessageId,
      sourceQueryId: input.sourceQueryId,
      artifactType: input.outputMode === "CHART" ? "ECHARTS_OPTION" : "MARKDOWN",
      title: artifactTitle,
      sourceRows: input.artifactRows,
      sourceColumns: input.artifactColumns ?? [
        { name: "symbol", type: "string" },
        { name: "marketValue", type: "number" },
        { name: "unrealizedPnl", type: "number" },
        { name: "weightPercent", type: "number" },
      ],
      markdownContent: input.outputMode === "FINANCIAL_REPORT"
        ? buildFinancialReportMarkdown(artifactTitle, input.answer, input.artifactRows)
        : undefined,
    });
    result.artifact = { artifactId: artifact.artifactId, analysisId: artifact.analysisId, status: artifact.status, previewUrl: `/api/v1/generated-artifacts/${artifact.artifactId}/preview` };
    const resultDb = getDatabase();
    resultDb.prepare("UPDATE agent_runs SET result_json=? WHERE id=? AND user_id=?").run(json(result), input.analysisId, input.userId);
    resultDb.close();
  }
  if (recommendationId) persistSseEvent({ analysisId: input.analysisId, type: "recommendation.created", payload: { recommendationId, status: input.recommendation?.compliance.status } });
  if (input.status === "completed" || input.status === "blocked" || input.status === "waiting_for_user") {
    persistSseEvent({
      analysisId: input.analysisId,
      type: "agent.completed",
      payload: {
        assistantMessageId,
        recommendationId,
        provider: input.provider,
        conversationKind: input.conversationKind,
        debateSuggestion: input.debateSuggestion,
        ...(input.status === "blocked" ? { status: "BLOCKED" } : {}),
        ...(input.status === "waiting_for_user" ? { status: "WAITING_FOR_USER" } : {}),
      },
    });
  }
  return result;
}

function persistAdvisorAnswerStream(analysisId: string, answer: string, status: "ACTIVE" | "DEGRADED" | "BLOCKED", conversationKind: "GUIDED_INTAKE" | "FINANCIAL_PLAN" | "DECISION"): void {
  const lines = answer.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return;
  persistSseEvent({
    analysisId,
    type: "advisor.thinking",
    payload: {
      phase: "final_summary",
      title: conversationKind === "GUIDED_INTAKE"
        ? "顾问正在梳理你的目标"
        : conversationKind === "FINANCIAL_PLAN"
          ? "顾问正在整理你的资金方案"
          : status === "ACTIVE" ? "顾问正在整理可执行建议" : "顾问正在整理公开结论",
      content: lines[0] ?? "",
    },
  });
  for (const line of lines.slice(1, 4)) {
    persistSseEvent({
      analysisId,
      type: "advisor.thinking",
      payload: {
        phase: "final_summary",
        title: "公开结论片段",
        content: line,
      },
    });
  }
  for (const line of lines) {
    persistSseEvent({
      analysisId,
      type: "assistant.delta",
      payload: { delta: `${line}\n` },
    });
  }
}

function persistRecommendation(db: ReturnType<typeof getDatabase>, userId: string, sessionId: string, analysisId: string, recommendationId: string, draft: RecommendationDraft, status: "ACTIVE" | "DEGRADED" | "BLOCKED", now: string, evidenceRootAnalysisId = analysisId) {
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
    .run(recommendationId, userId, evidenceRootAnalysisId, evidenceRootAnalysisId);
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

function buildFinancialReportMarkdown(title: string, answer: string, rows: Record<string, unknown>[]): string {
  const body = answer.trim().startsWith("#")
    ? answer.trim()
    : `# ${title}\n\n## Agent 结论\n\n${answer.trim()}`;
  const appendix = rows.length
    ? [
      "## 当前持仓附录",
      "",
      "| 标的 | 名称 | 市值 | 浮盈亏 | 权重 |",
      "| --- | --- | ---: | ---: | ---: |",
      ...rows.map((row) => `| ${markdownCell(row.symbol)} | ${markdownCell(row.name)} | ${markdownCell(row.marketValue)} | ${markdownCell(row.unrealizedPnl)} | ${markdownPercent(row.weightPercent)} |`),
    ].join("\n")
    : "## 当前持仓附录\n\n本次没有可用的持仓明细。";
  return `${body}\n\n${appendix}\n\n---\n\n本报告由资产顾问 Agent 基于当前持仓生成，用于投资研究和方案模拟，不构成真实交易指令。`;
}

function markdownCell(value: unknown): string {
  return String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function markdownPercent(value: unknown): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric.toFixed(2).replace(/\.?0+$/u, "")}%` : markdownCell(value);
}
