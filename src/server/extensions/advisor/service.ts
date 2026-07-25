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
        ? buildFinancialReportMarkdown(artifactTitle, input.answer, input.artifactRows, input.recommendation, input.recommendationStatus)
        : undefined,
      recommendationId,
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

export function buildFinancialReportMarkdown(
  title: string,
  answer: string,
  rows: Record<string, unknown>[],
  recommendation: RecommendationDraft | null = null,
  status: "ACTIVE" | "DEGRADED" | "BLOCKED" = "DEGRADED",
): string {
  const fields = parseAnswerFields(answer);
  const action = recommendation?.action ?? extractAction(fields.action);
  const summary = recommendation?.summary ?? fields.conclusion ?? "报告已完成，建议结合下方风险提示理解当前组合。";
  const reasons = recommendation?.reasons?.length
    ? recommendation.reasons
    : fields.conclusion ? [fields.conclusion] : [];
  const risks = recommendation?.risks ?? [];
  const counterEvidence = recommendation?.counterEvidence?.length
    ? recommendation.counterEvidence
    : fields.counterEvidence ? [fields.counterEvidence] : [];
  const invalidation = recommendation?.invalidation ?? "";
  const portfolioEvidence = [
    rows.length ? `报告生成时读取到 ${rows.length} 项持仓快照，具体明细见下方附录。` : "本次未获得可用的持仓明细。",
    fields.portfolioFacts,
    fields.portfolioImpact,
    fields.risk ? translateRiskText(fields.risk) : "",
  ].filter(Boolean);
  const marketEvidence = [
    fields.technical,
    fields.research,
    recommendation?.provenance && typeof recommendation.provenance.dataState === "string"
      ? `数据状态：${recommendation.provenance.dataState}`
      : "",
    recommendation?.dataAsOf ? `数据截至：${recommendation.dataAsOf}` : "",
  ].filter(Boolean);
  const fundamentalEvidence = fields.fundamental
    ? [fields.fundamental]
    : ["本次未获得可用的基本面或消息面证据，未将这类信息作为支持理由。"];
  const actionEvidence = [
    ...reasons,
    fields.portfolioImpact ? `这项判断对组合的影响是：${fields.portfolioImpact}` : "",
    `因此当前对应的动作是“${translateAction(action)}”。`,
  ].filter(Boolean);

  return [
    `# ${title}`,
    "",
    "## 先看结论",
    "",
    `**建议状态：** ${translateStatus(status)}`,
    `**建议动作：** ${translateAction(action)}`,
    `**一句话判断：** ${friendlySummary(summary, action, status)}`,
    `**你现在可以怎么做：** ${beginnerGuidanceFor(action, status)}`,
    "",
    "## 为什么这样判断",
    "",
    "### 你的画像和目标",
    ...toBulletLines([fields.profile], "本次未获得可用的用户画像和投资目标证据，不能据此做个性化判断。"),
    "",
    "### 组合事实",
    "",
    ...toBulletLines(portfolioEvidence, "本次未获得可用的组合事实。"),
    "",
    "### 行情与技术观察",
    ...toBulletLines(marketEvidence, "本次未获得可用的行情或技术面证据，不能据此判断趋势。"),
    "",
    "### 基本面与消息面",
    ...toBulletLines(fundamentalEvidence, "本次未获得可用的基本面或消息面证据，未据此做判断。"),
    "",
    "### 反方证据",
    ...toBulletLines([...counterEvidence, ...risks].filter(Boolean), "本次未记录额外的反方证据；市场变化仍可能使判断失效。"),
    "",
    "### 为什么对应这个动作",
    ...toBulletLines(actionEvidence, "暂未记录足够的动作依据。"),
    invalidation ? `- **需要重新判断的情况：** ${translateReportText(invalidation)}` : "",
    fields.compliance ? `- **研究边界：** ${translateReportText(fields.compliance)}` : "",
    "",
    buildHoldingsAppendix(rows),
    "",
    "---",
    "",
    "本报告由资产智能顾问基于当前持仓生成，仅用于投资研究和方案模拟，不构成真实交易指令。",
  ].join("\n");
}

function markdownCell(value: unknown): string {
  return String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function markdownPercent(value: unknown): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric.toFixed(2).replace(/\.?0+$/u, "")}%` : markdownCell(value);
}

function parseAnswerFields(answer: string): Record<string, string> {
  const valueFor = (label: string) => answer
    .split("\n")
    .map((line) => line.match(new RegExp(`^${label}[：:]\\s*(.+)$`, "u"))?.[1]?.trim() ?? "")
    .find(Boolean) ?? "";
  return {
    action: answer.match(/建议动作[：:]\s*([A-Z_]+)/u)?.[1] ?? "",
    conclusion: valueFor("核心结论"),
    profile: valueFor("用户画像与投资目标依据") || valueFor("本次画像假设"),
    research: valueFor("数据研究"),
    technical: valueFor("行情与技术观察"),
    fundamental: valueFor("基本面与消息面依据"),
    portfolioImpact: valueFor("组合影响"),
    portfolioFacts: valueFor("组合事实"),
    risk: valueFor("风险复核"),
    counterEvidence: valueFor("反方证据"),
    compliance: valueFor("合规结论"),
  };
}

function extractAction(value: string): RecommendationDraft["action"] {
  const actions: RecommendationDraft["action"][] = ["WATCH", "TRIAL_BUY", "SCALE_IN", "HOLD", "STOP_ADDING", "SCALE_OUT", "EXIT"];
  return actions.find((action) => value.includes(action)) ?? "WATCH";
}

function translateStatus(status: string): string {
  if (status === "ACTIVE") return "可以继续执行（画像、数据和风险检查基本通过）";
  if (status === "BLOCKED") return "暂不执行（还有关键信息或风险需要先确认）";
  return "谨慎参考（可以用于研究，但不建议直接照做）";
}

function translateAction(action: string): string {
  const labels: Record<string, string> = {
    WATCH: "先观察，不急着买卖",
    TRIAL_BUY: "小额试仓，先验证判断",
    SCALE_IN: "分批加仓，不一次性投入",
    HOLD: "继续持有，暂不调整",
    STOP_ADDING: "停止加仓，先控制集中度",
    SCALE_OUT: "分批减仓，逐步降低风险",
    EXIT: "清仓退出，停止继续承担该风险",
  };
  return labels[action] ?? labels.WATCH;
}

function friendlySummary(summary: string, action: string, status: string): string {
  const cleaned = translateReportText(summary).replace(/[。；;]+$/u, "");
  if (action === "STOP_ADDING") return `${cleaned}。简单说，先不要继续买入占比已经偏高的持仓。`;
  if (action === "SCALE_OUT") return `${cleaned}。简单说，先分几次降低风险，不需要一次性卖完。`;
  if (action === "EXIT") return `${cleaned}。简单说，当前不适合继续承担这项风险。`;
  if (status === "BLOCKED") return `${cleaned}。简单说，信息还不够，先别急着做决定。`;
  if (status === "DEGRADED") return `${cleaned}。简单说，这是一份谨慎参考，操作前要再核对最新行情。`;
  return cleaned;
}

function beginnerGuidanceFor(action: string, status: string): string {
  if (status === "BLOCKED") return "先补齐缺少的信息或等待行情恢复，再决定是否调整持仓。";
  if (action === "STOP_ADDING") return "暂时不再买入这类资产，把新增资金留作现金或分散到其他风险来源。";
  if (action === "SCALE_OUT") return "可以考虑分几次减少仓位，每次操作前都重新检查组合占比。";
  if (action === "EXIT") return "不要继续追加资金；如果决定退出，先确认资金用途和交易成本。";
  if (action === "SCALE_IN" || action === "TRIAL_BUY") return "只用可以承受波动的小部分资金分批验证，不要一次性投入。";
  return "先保持现状，观察数据和组合变化，不因为短期涨跌急着操作。";
}

function translateReportText(value: string): string {
  return value
    .replaceAll("Agent", "智能顾问")
    .replaceAll("PandaData", "行情数据服务")
    .replaceAll("get_stock_rt_daily", "实时日行情接口")
    .replaceAll("get_stock_daily", "股票日行情接口")
    .replaceAll("get_fund_daily", "基金日行情接口")
    .replaceAll("get_index_daily", "指数日行情接口")
    .replaceAll("get_us_daily", "美股日行情接口")
    .replaceAll("get_hk_daily", "港股日行情接口")
    .replaceAll(" via ", "，来源于")
    .replaceAll("LATEST_TRADING_DAY", "最近交易日收盘数据")
    .replaceAll("LIVE_FRESH", "最新实时行情")
    .replaceAll("STALE", "较旧行情")
    .replaceAll("UNAVAILABLE", "暂无可用行情")
    .replaceAll("NOT_REQUIRED", "本次不需要外部行情")
    .replaceAll("DEGRADED", "谨慎参考")
    .replaceAll("ACTIVE", "可以继续执行")
    .replaceAll("BLOCKED", "暂不执行")
    .replaceAll("STOP_ADDING", "停止加仓")
    .replaceAll("SCALE_IN", "分批加仓")
    .replaceAll("SCALE_OUT", "分批减仓")
    .replaceAll("TRIAL_BUY", "小额试仓")
    .replaceAll("WATCH", "观察")
    .replaceAll("HOLD", "继续持有")
    .replaceAll("EXIT", "清仓退出")
    .replaceAll("BALANCED", "平衡型")
    .replaceAll("CONSERVATIVE", "保守型")
    .replaceAll("AGGRESSIVE", "进取型")
    .replaceAll("BROAD_INDEX_ETF", "宽基指数或 ETF")
    .replaceAll("FACTOR_RESEARCH", "因子研究")
    .replaceAll("STRATEGY_BACKTEST", "策略回测")
    .replaceAll("HHI", "集中度指标");
}

function translateRiskText(value: string): string {
  return translateReportText(value)
    .replace(/组合非现金持仓\s*(\d+)\s*项/u, "除现金外共有 $1 项持仓")
    .replace(/最大持仓权重\s*([0-9.]+)%/u, "最大的一项持仓占组合 $1%")
    .replace(/集中度指标\s*([0-9.]+)/u, "集中度指标为 $1（越接近 1 代表越集中）")
    .replace(/已计算\s*(\d+)\s*个标的的历史风险指标/u, "已计算 $1 个标的的历史波动和回撤");
}

function toBulletLines(items: string[], fallback: string): string[] {
  const normalized = items.map((item) => translateReportText(item)).filter(Boolean);
  return normalized.length ? normalized.map((item) => `- ${item}`) : [`- ${fallback}`];
}

function buildHoldingsAppendix(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "## 当前持仓附录\n\n本次没有可用的持仓明细。";
  return [
    "## 当前持仓附录",
    "",
    "下面是生成报告时读取到的持仓快照。市值和浮动盈亏会随行情变化，不能替代最新成交价。",
    "",
    "| 证券代码 | 持仓名称 | 当前市值（元） | 浮动盈亏（元） | 组合占比 |",
    "| --- | --- | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${markdownCell(row.symbol)} | ${markdownCell(row.name)} | ${formatReportNumber(row.marketValue)} | ${formatReportNumber(row.unrealizedPnl)} | ${markdownPercent(row.weightPercent)} |`),
  ].join("\n");
}

function formatReportNumber(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return markdownCell(value);
  return numeric.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
