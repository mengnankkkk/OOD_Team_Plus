import Decimal from "decimal.js";

import {
  runChiefAdvisor,
  runChiefAdvisorConversation,
  runChiefAdvisorScreening,
  type ChiefAdvisorDecisionIntegrity,
  type ChiefAdvisorStreamEvent,
} from "@/mastra/agents/chief-advisor";
import { callPandaData } from "@/server/extensions/pandadata/adapter";
import { executePandaSources, type PandaSourceExecution } from "@/server/extensions/query/panda-query-executor";
import type { PandaQuerySource } from "@/server/extensions/query/market-catalog";
import { runResearchSearch, type ResearchSearchResult } from "@/server/extensions/search/service";
import { sanitizeResearchText } from "@/server/extensions/search/text";
import { persistSseEvent } from "@/server/extensions/sse/event-persister";
import { createId, getDatabase, isoNow, json } from "@/server/http/context";

import {
  AgentFindingSchema,
  AdvisorDecisionSchema,
  attachTrustedTargetSymbol,
  type AgentFinding,
  type AdvisorDecision,
  type DebateSuggestion,
  type ProfessionalAgentRole,
} from "./professional-contracts";
import { runFinancialPlanningAdvisor } from "./planning-advisor";
import { observedAtForFinding } from "./evidence-observation-time";
import { loadAdvisorSemanticToolsContext, summarizeAdvisorSemanticToolsContext, type AdvisorSemanticToolsContext } from "./semantic-tools";
import type { AdvisorWorkflow, RecommendationDraft } from "./types";

export { AgentFindingSchema, AdvisorDecisionSchema } from "./professional-contracts";
export type { AgentFinding, AdvisorDecision, ProfessionalAgentRole } from "./professional-contracts";

type AdvisorIntent =
  | "BUY"
  | "SELL"
  | "DIAGNOSIS"
  | "FACTOR_RESEARCH"
  | "STRATEGY_BACKTEST"
  | "SCREENING"
  | "PLANNING"
  | "GENERAL";
type PublicationStatus = "ACTIVE" | "DEGRADED" | "BLOCKED";
type DataState = "LIVE_FRESH" | "LATEST_TRADING_DAY" | "STALE" | "UNAVAILABLE" | "NOT_REQUIRED";

type Profile = {
  risk_level?: string | null;
  investment_amount_decimal?: string | null;
  horizon?: string | null;
  max_drawdown_decimal?: string | null;
  preferences_json?: string | null;
};

type Goal = {
  name: string;
  target_amount_decimal: string;
  target_date: string | null;
  horizon: string;
  priority: string;
  asset_preference: string | null;
};

type Holding = {
  instrument_id: string;
  symbol: string;
  name: string;
  asset_type: string;
  market: string | null;
  sector: string | null;
  quantity_decimal: string;
  cost_decimal: string;
  price_decimal: string;
  market_value_decimal: string;
  unrealized_pnl_decimal: string;
  weight_bps: number;
};

type Instrument = { id: string; symbol: string; name: string; asset_type: string; market: string; sector?: string | null };

type ResearchState = {
  dataState: DataState;
  executions: PandaSourceExecution[];
  closes: Decimal[];
  latest: Decimal | null;
  asOfDate: string | null;
  quotes: Array<{ symbol: string; name: string; latest: string | null; asOfDate: string | null; method: string }>;
  riskMetrics: Array<{ symbol: string; observations: number; annualizedVolatility: string | null; maxDrawdown: string | null }>;
  correlations: Array<{ left: string; right: string; observations: number; value: string | null }>;
  fundamentalSearch?: {
    query: string;
    searchId: string;
    searchIds?: string[];
    results: ResearchSearchResult[];
    sourceStatuses: Array<{ adapter: string; status: string; resultCount: number; error?: { code: string; message: string; retryable: boolean } | null }>;
  };
  study?: ResearchStudy;
};

type ResearchStudy =
  | { kind: "FACTOR_RESEARCH"; factors: string[]; rows: number; summary: string; missing: string[] }
  | { kind: "STRATEGY_BACKTEST"; strategy: string; observations: number; trades: number; totalReturn: string | null; buyAndHoldReturn: string | null; maxDrawdown: string | null; summary: string; missing: string[] };

type RoleRunResult = {
  childRunId: string;
  finding: AgentFinding;
};

type ProfileCompleteness = {
  complete: boolean;
  missing: string[];
};

export type ProfessionalAdvisorResult = {
  kind: "CONVERSATION" | "GUIDED_INTAKE" | "FINANCIAL_PLAN" | "SCREENING" | "DECISION";
  runId: string;
  status: PublicationStatus;
  direction: AdvisorDecision["requestedDirection"];
  action: AdvisorDecision["action"];
  findings: AgentFinding[];
  missingInformation: string[];
  recommendation: RecommendationDraft | null;
  answer: string;
  provider: "CHIEF_ADVISOR" | "PLANNING_ADVISOR" | "DETERMINISTIC_FALLBACK";
  debateSuggestion: DebateSuggestion;
};

export async function runProfessionalAdvisor(input: {
  userId: string;
  sessionId: string;
  analysisId: string;
  rootAnalysisId?: string;
  content: string;
  targetSymbol?: string;
  workflow?: AdvisorWorkflow;
}): Promise<ProfessionalAdvisorResult> {
  const db = getDatabase();
  const now = isoNow();
  const rootAnalysisId = input.rootAnalysisId ?? input.analysisId;
  db.prepare(`UPDATE agent_runs SET session_id=?,root_run_id=?,agent_type='chief_advisor',objective=?,started_at=COALESCE(started_at,?)
    WHERE id=? AND user_id=?`).run(input.sessionId, rootAnalysisId, input.content.slice(0, 500), now, input.analysisId, input.userId);
  const profile = db.prepare("SELECT risk_level,investment_amount_decimal,horizon,max_drawdown_decimal,preferences_json FROM user_profiles WHERE user_id=?").get(input.userId) as Profile | undefined;
  const conversationMessages = db.prepare("SELECT content FROM messages WHERE session_id=? AND role='user' ORDER BY created_at ASC")
    .all(input.sessionId) as Array<{ content: string }>;
  const goals = db.prepare(`SELECT name,target_amount_decimal,target_date,horizon,priority,asset_preference
    FROM goals WHERE user_id=? AND status='active' ORDER BY created_at DESC`).all(input.userId) as Goal[];
  const snapshot = db.prepare("SELECT * FROM portfolio_snapshots WHERE user_id=? ORDER BY as_of DESC,created_at DESC LIMIT 1").get(input.userId) as Record<string, unknown> | undefined;
  const holdings = snapshot ? db.prepare(`SELECT hs.instrument_id,i.symbol,i.name,i.asset_type,i.market,i.sector,
      hs.quantity_decimal,hs.cost_decimal,hs.price_decimal,hs.market_value_decimal,hs.unrealized_pnl_decimal,hs.weight_bps
    FROM holding_snapshots hs JOIN instruments i ON i.id=hs.instrument_id
    WHERE hs.portfolio_snapshot_id=? ORDER BY hs.weight_bps DESC`).all(snapshot.id) as Holding[] : [];
  const instruments = db.prepare("SELECT id,symbol,name,asset_type,market,sector FROM instruments WHERE tradable=1 ORDER BY symbol").all() as Instrument[];
  const priorConversationMessages = conversationMessages.at(-1)?.content === input.content
    ? conversationMessages.slice(0, -1)
    : conversationMessages;
  const intent = inferIntent(input.content, priorConversationMessages.map((message) => message.content));
  const requestedDirection = directionForIntent(intent);
  const target = resolveTargetInstrument({
    content: input.content,
    targetSymbol: input.targetSymbol,
    instruments,
    holdings,
  });
  const targetHolding = target ? holdings.find((holding) => holding.instrument_id === target.id) ?? null : null;
  const dailyPortfolio = input.workflow === "DAILY_PORTFOLIO";
  const decisionProfile = dailyPortfolio ? profileWithDailyAssumptions(profile) : profile;
  const profileCompleteness = profileCompletenessFor(decisionProfile, dailyPortfolio);
  const requiredRoles = rolesFor(intent, Boolean(target), holdings.length > 0, input.content);
  const findings: AgentFinding[] = [];
  const roleRunIds = new Map<ProfessionalAgentRole, string>();

  const registerFinding = (result: RoleRunResult): AgentFinding => {
    roleRunIds.set(result.finding.agent, result.childRunId);
    findings.push(result.finding);
    return result.finding;
  };

  try {
    if (!dailyPortfolio && intent === "SCREENING") {
      const screening = await screenInstruments({
        db,
        analysisId: input.analysisId,
        content: input.content,
        conversationMessages: priorConversationMessages.map((message) => message.content),
        profile: decisionProfile,
        holdings,
        snapshot,
        instruments,
      });
      db.prepare("UPDATE agent_runs SET agent_type='chief_advisor_screening',model_provider=?,model_name=?,output_summary=? WHERE id=? AND user_id=?")
        .run(
          screening.provider === "CHIEF_ADVISOR" ? "deepseek" : "deterministic",
          screening.provider === "CHIEF_ADVISOR" ? process.env.DEEPSEEK_MODEL ?? null : null,
          screening.answer.slice(0, 500),
          input.analysisId,
          input.userId,
        );
      return {
        kind: "SCREENING",
        runId: input.analysisId,
        status: "DEGRADED",
        direction: "HOLD",
        action: "WATCH",
        findings: [],
        missingInformation: [],
        recommendation: null,
        answer: screening.answer,
        provider: screening.provider,
        debateSuggestion: {
          recommended: false,
          motion: "当前候选筛选暂不适合进入多空 Battle",
          reason: "先从候选中选定一个标的，再进行完整分析和多空比较更有意义。",
        },
      };
    }

    if (!dailyPortfolio && intent === "PLANNING" && !requestsFullAgentLoop(input.content)) {
      const planning = await runFinancialPlanningAdvisor({
        question: input.content,
        messages: conversationMessages.map((message) => message.content),
        profile,
        goals,
        holdings,
      });
      db.prepare("UPDATE agent_runs SET agent_type='planning_advisor',model_provider=?,model_name=?,output_summary=? WHERE id=? AND user_id=?")
        .run(planning.provider === "PLANNING_ADVISOR" ? "deepseek" : "deterministic", planning.modelName, planning.answer.slice(0, 500), input.analysisId, input.userId);
      return {
        kind: "FINANCIAL_PLAN",
        runId: input.analysisId,
        status: "DEGRADED",
        direction: "HOLD",
        action: "WATCH",
        findings: [],
        missingInformation: [],
        recommendation: null,
        answer: planning.answer,
        provider: planning.provider,
        debateSuggestion: {
          recommended: false,
          motion: "当前理财规划暂不适合进入多空 Battle",
          reason: "先把资金目标、期限和风险边界梳理清楚，比立即进行多空辩论更适合理财新手。",
        },
      };
    }

    if (!dailyPortfolio && intent === "GENERAL" && !target && !requestsFullAgentLoop(input.content)) {
      const conversationContext = buildChiefConversationContext({
        profile: decisionProfile,
        profileCompleteness,
        goals,
        holdings,
        snapshot,
        conversationMessages: conversationMessages.map((message) => message.content),
      });
      let answer = formatAdvisorConversationFallback(input.content, profileCompleteness);
      let provider: ProfessionalAdvisorResult["provider"] = "DETERMINISTIC_FALLBACK";
      if (process.env.DEEPSEEK_API_KEY?.trim()) {
        try {
          const conversation = await runChiefAdvisorConversation({
            question: input.content,
            conversationMessages: conversationMessages.map((message) => message.content),
            context: conversationContext,
          });
          answer = conversation.answer;
          provider = conversation.provider;
        } catch {
          // The conversational fallback remains useful without turning a greeting into a failed advisory run.
        }
      }
      db.prepare("UPDATE agent_runs SET agent_type='chief_advisor_conversation',model_provider=?,model_name=?,output_summary=? WHERE id=? AND user_id=?")
        .run(
          provider === "CHIEF_ADVISOR" ? "deepseek" : "deterministic",
          provider === "CHIEF_ADVISOR" ? process.env.DEEPSEEK_MODEL ?? null : null,
          answer.slice(0, 500),
          input.analysisId,
          input.userId,
        );
      return {
        kind: "CONVERSATION",
        runId: input.analysisId,
        status: "DEGRADED",
        direction: "HOLD",
        action: "WATCH",
        findings: [],
        missingInformation: profileCompleteness.missing,
        recommendation: null,
        answer,
        provider,
        debateSuggestion: {
          recommended: false,
          motion: "当前普通顾问对话暂不适合进入多空 Battle",
          reason: "当前还没有明确的投资判断分歧，先把用户真正想解决的问题聊清楚更有帮助。",
        },
      };
    }

    const profileFinding = registerFinding(await runRole(db, input, "PROFILE_CONTEXT", () => profileFindingFor(profile, dailyPortfolio), { emitEvents: false }));

    let research: ResearchState = { dataState: target || holdings.length ? "UNAVAILABLE" : "NOT_REQUIRED", executions: [], closes: [], latest: null, asOfDate: null, quotes: [], riskMetrics: [], correlations: [] };
    if (requiredRoles.includes("DATA_RESEARCH")) {
      registerFinding(await runRole(db, input, "DATA_RESEARCH", async (childRunId) => {
        const result = await researchInstrument(db, input.analysisId, childRunId, target, holdings, intent, input.content);
        research = result.state;
        return result.finding;
      }, { emitEvents: false }));
    }

    const riskFinding = registerFinding(await runRole(db, input, "PORTFOLIO_RISK", () => portfolioRiskFinding(holdings, snapshot, research), { emitEvents: false }));
    if (dailyPortfolio && (target || holdings.length)) {
      const fundamentalSearch = await searchFundamentalAndNews(input, target, holdings);
      research.fundamentalSearch = fundamentalSearch;
    }

    const deterministicDecision = deterministicDecisionFor({
      intent,
      requestedDirection,
      target,
      targetHolding,
      profileReady: dailyPortfolio || profileFinding.missingInformation.length === 0,
      hasHoldings: holdings.length > 0,
      research,
      riskFinding,
    });
    if (requiredRoles.includes("RECOMMENDATION")) {
      registerFinding(await runRole(db, input, "RECOMMENDATION", () => recommendationFinding(deterministicDecision, findings), { emitEvents: false }));
    }

    const criticalMissing = criticalMissingInformation(intent, profile, target, targetHolding, holdings.length > 0, dailyPortfolio);
    const complianceFinding = complianceFindingFor(criticalMissing, research.dataState, findings, dailyPortfolio);
    if (requiredRoles.includes("COMPLIANCE_REVIEWER")) {
      registerFinding(await runRole(db, input, "COMPLIANCE_REVIEWER", () => complianceFinding, { emitEvents: false }));
    }
    if (requiredRoles.includes("EXPLANATION_REPORT")) {
      registerFinding(await runRole(db, input, "EXPLANATION_REPORT", () => explanationReportFinding(findings), { emitEvents: false }));
    }
    const semanticContext = await loadAdvisorSemanticToolsContext(db, {
      analysisId: input.analysisId,
      question: input.content,
    });
    const chiefContext = buildChiefAdvisorContext({
      input,
      profile: decisionProfile,
      profileCompleteness,
      goals,
      holdings,
      snapshot,
      target,
      research,
      findings,
      requiredRoles,
      semanticContext,
      dailyPortfolio,
    });

    let candidate = deterministicDecision;
    let provider: ProfessionalAdvisorResult["provider"] = "DETERMINISTIC_FALLBACK";
    let modelFallback = true;
    let unresolvedConflict = false;
    let decisionIntegrity: ChiefAdvisorDecisionIntegrity | undefined;
    const streamSnippets = new Map<string, string>();
    if (!process.env.DEEPSEEK_API_KEY?.trim()) {
      persistSseEvent({
        analysisId: input.analysisId,
        type: "advisor.thinking",
        payload: {
          phase: "model_unavailable",
          title: "模型服务未配置，进入降级建议",
          content: "已保留画像、数据、组合风险与合规节点结果；发布门不会把降级结论标记为 ACTIVE。",
        },
      });
      persistSseEvent({ analysisId: input.analysisId, type: "agent.failed", payload: { code: "MODEL_REQUIRED", retryable: true } });
    } else {
      try {
        const model = await runChiefAdvisor({
          prompt: chiefPrompt(input.content, decisionProfile, goals, holdings, snapshot, target, research, findings, requiredRoles, semanticContext, dailyPortfolio),
          context: chiefContext,
          requiredAgents: requiredRoles,
          fallbackFindings: findings,
          onAgentStarted: (agent, label) => {
            markModelAttemptStarted(db, roleRunIds.get(agent), label);
            persistSseEvent({ analysisId: input.analysisId, type: "agent.delegated", payload: { agent, label, childRunId: roleRunIds.get(agent), model: true } });
          },
          onAgentCompleted: (finding) => {
            persistModelFinding(db, roleRunIds.get(finding.agent), finding);
            persistSseEvent({ analysisId: input.analysisId, type: "advisor.thinking", payload: {
              phase: "specialist", agent: finding.agent, title: `${finding.agent} 已形成完整公开结论`, content: finding.conclusion,
            } });
            persistSseEvent({ analysisId: input.analysisId, type: "agent.completed", payload: { agent: finding.agent, childRunId: roleRunIds.get(finding.agent), conclusion: finding.conclusion, model: true } });
          },
          onAgentFailed: (agent, error) => {
            persistSseEvent({
              analysisId: input.analysisId,
              type: "agent.failed",
              payload: { agent, code: "MODEL_OUTPUT_INVALID", retryable: true, message: safeMessage(error) },
            });
            persistModelAttemptFailure(db, roleRunIds.get(agent), findings.find((finding) => finding.agent === agent), error);
          },
          onStreamEvent: (event) => persistModelStreamEvent(input.analysisId, event, streamSnippets),
        });
        findings.splice(0, findings.length, ...mergeModelFindings(findings, model.findings, research));
        const preserved = preserveDirection(model.decision, deterministicDecision);
        unresolvedConflict = preserved.conflict;
        candidate = preserved.decision;
        if (unresolvedConflict) persistConflict(db, input.analysisId, candidate, model.decision);
        provider = "CHIEF_ADVISOR";
        modelFallback = model.fallbackAgents.length > 0;
        decisionIntegrity = model.decisionIntegrity;
      } catch (error) {
        persistSseEvent({
          analysisId: input.analysisId,
          type: "advisor.thinking",
          payload: {
            phase: "model_failed",
            title: "模型服务暂时未完成，进入降级建议",
            content: "已保留服务端专业节点结果；发布门不会把降级结论标记为 ACTIVE。",
          },
        });
        persistSseEvent({ analysisId: input.analysisId, type: "agent.failed", payload: { code: "MODEL_UNAVAILABLE", retryable: true, message: safeMessage(error) } });
      }
    }

    const status = enforcePublicationStatus({
      candidate,
      criticalMissing,
      dataState: research.dataState,
      findings,
      modelFallback,
      unresolvedConflict,
      marketDataRequired: requiredRoles.includes("DATA_RESEARCH") && (dailyPortfolio || intent === "BUY" || intent === "SELL" || isResearchStudy(intent)),
      latestTradingDayAllowed: dailyPortfolio,
      decisionIntegrity,
    });
    const publicationReasons = publicationSafetyReasons(candidate);
    candidate = {
      ...candidate,
      action: publishedAction(candidate.action, status, Boolean(targetHolding)),
      compliance: {
        approved: status === "ACTIVE",
        decision: status === "ACTIVE" ? "APPROVED" : status === "BLOCKED" ? "BLOCKED" : "DOWNGRADED",
        reason: [
          status === "ACTIVE"
            ? "服务端数据、证据、风险和合规门均已通过"
            : status === "BLOCKED"
              ? "存在必须先补齐或确认的关键信息"
              : `建议可供研究和模拟采纳；数据状态为 ${research.dataState}`,
          ...publicationReasons,
        ].join("；"),
      },
    };
    const recommendation = !isResearchStudy(intent) && target
      ? buildRecommendationDraft({
        status,
        candidate,
        target,
        holding: targetHolding,
        profile: decisionProfile,
        assumptions: dailyPortfolio ? profileFinding.supportEvidence : [],
        research,
        snapshot,
      })
      : !isResearchStudy(intent) && holdings.length > 0
        ? buildPortfolioRecommendationDraft({
          status,
          candidate,
          profile: decisionProfile,
          assumptions: dailyPortfolio ? profileFinding.supportEvidence : [],
          holdings,
          research,
          snapshot,
        })
        : null;
    persistFindings(db, input.userId, input.analysisId, findings, research.executions);
    db.prepare("UPDATE agent_runs SET model_provider=?,model_name=?,output_summary=?,compliance_json=? WHERE id=?")
      .run(provider === "CHIEF_ADVISOR" ? "deepseek" : "deterministic", process.env.DEEPSEEK_MODEL ?? null,
        candidate.summary, json({ status, approved: status === "ACTIVE", simulationOnly: true, reasons: publicationReasons }), input.analysisId);
    persistSseEvent({
      analysisId: input.analysisId,
      type: "compliance.completed",
      payload: { status, dataState: research.dataState, modelFallback, unresolvedConflict, reasons: publicationReasons },
    });
    const missingInformation = followUpInformation(intent, criticalMissing, findings);
    return {
      kind: "DECISION",
      runId: input.analysisId,
      status,
      direction: candidate.requestedDirection,
      action: candidate.action,
      findings,
      missingInformation,
      recommendation,
      answer: formatAdvisorDecisionAnswer(candidate, status, findings, research, publicationReasons, profile, goals),
      provider,
      debateSuggestion: attachTrustedTargetSymbol(candidate.debateSuggestion, target?.symbol),
    };
  } finally {
    db.close();
  }
}

function followUpInformation(intent: AdvisorIntent, criticalMissing: string[], findings: AgentFinding[]): string[] {
  const promptable = new Set(["risk_level", "investment_amount", "horizon", "max_drawdown", "instrument_preference", "near_term_use", "instrument", "target_holding", "holdings"]);
  const derived = findings.flatMap((finding) => finding.missingInformation).filter((key) => promptable.has(key));
  const needsHoldings = intent === "DIAGNOSIS";
  return [...new Set([...criticalMissing, ...derived.filter((key) => key !== "holdings" || needsHoldings)])];
}

async function runRole(
  db: ReturnType<typeof getDatabase>,
  input: { userId: string; sessionId: string; analysisId: string; rootAnalysisId?: string },
  role: ProfessionalAgentRole,
  operation: (childRunId: string) => AgentFinding | Promise<AgentFinding>,
  options: { emitEvents?: boolean } = {},
): Promise<RoleRunResult> {
  const emitEvents = options.emitEvents ?? true;
  const childRunId = createId("agent_run");
  const startedAt = isoNow();
  db.prepare(`INSERT INTO agent_runs
    (id,user_id,type,status,session_id,parent_run_id,root_run_id,agent_type,objective,started_at,created_at)
    VALUES (?,?,'professional_agent','running',?,?,?,?,?,?,?)`).run(
    childRunId, input.userId, input.sessionId, input.analysisId, input.rootAnalysisId ?? input.analysisId, role.toLowerCase(), role, startedAt, startedAt,
  );
  if (emitEvents) persistSseEvent({ analysisId: input.analysisId, type: "agent.delegated", payload: { agent: role, childRunId } });
  try {
    const finding = AgentFindingSchema.parse(await operation(childRunId));
    db.prepare("UPDATE agent_runs SET status='completed',completed_at=?,output_summary=?,result_json=? WHERE id=?")
      .run(isoNow(), finding.conclusion, json(finding), childRunId);
    if (emitEvents) persistSseEvent({ analysisId: input.analysisId, type: "agent.completed", payload: { agent: role, childRunId, conclusion: finding.conclusion } });
    return { childRunId, finding };
  } catch (error) {
    db.prepare("UPDATE agent_runs SET status='failed',completed_at=?,failure_code='AGENT_NODE_FAILED',failure_message=? WHERE id=?")
      .run(isoNow(), safeMessage(error), childRunId);
    if (emitEvents) persistSseEvent({ analysisId: input.analysisId, type: "agent.failed", payload: { agent: role, childRunId, code: "AGENT_NODE_FAILED" } });
    throw error;
  }
}

function markModelAttemptStarted(db: ReturnType<typeof getDatabase>, childRunId: string | undefined, inputSummary: string): void {
  if (!childRunId) return;
  db.prepare("UPDATE agent_runs SET status='running',model_provider='deepseek',model_name=?,objective=?,input_summary=?,failure_code=NULL,failure_message=NULL WHERE id=?")
    .run(process.env.DEEPSEEK_MODEL ?? null, inputSummary, inputSummary, childRunId);
}

function persistModelFinding(db: ReturnType<typeof getDatabase>, childRunId: string | undefined, finding: AgentFinding): void {
  if (!childRunId) return;
  db.prepare(`UPDATE agent_runs
    SET status='completed',completed_at=?,model_provider='deepseek',model_name=?,output_summary=?,result_json=?,
        failure_code=NULL,failure_message=NULL
    WHERE id=?`).run(isoNow(), process.env.DEEPSEEK_MODEL ?? null, finding.conclusion, json(finding), childRunId);
}

function persistModelAttemptFailure(db: ReturnType<typeof getDatabase>, childRunId: string | undefined, fallback: AgentFinding | undefined, error: unknown): void {
  if (!childRunId) return;
  db.prepare(`UPDATE agent_runs
    SET status='failed',completed_at=?,model_provider='deepseek',model_name=?,
        output_summary=COALESCE(?,output_summary),result_json=COALESCE(?,result_json),
        failure_code='MODEL_OUTPUT_INVALID',failure_message=?
    WHERE id=?`).run(isoNow(), process.env.DEEPSEEK_MODEL ?? null, fallback?.conclusion ?? null, fallback ? json(fallback) : null, safeMessage(error), childRunId);
}

function persistModelStreamEvent(analysisId: string, event: ChiefAdvisorStreamEvent, snippets: Map<string, string>): void {
  if (event.type === "agent.object") {
    const conclusion = typeof event.partial.conclusion === "string" ? event.partial.conclusion.trim() : "";
    if (!shouldEmitStreamSnippet(`agent:${event.agent}`, conclusion, snippets)) return;
    persistSseEvent({
      analysisId,
      type: "advisor.thinking",
      payload: {
        phase: "specialist",
        agent: event.agent,
        title: `${event.agent} 正在形成可公开结论`,
        content: conclusion,
      },
    });
    return;
  }
  if (event.type === "decision.object") {
    const summary = typeof event.partial.summary === "string" ? event.partial.summary.trim() : "";
    if (!shouldEmitStreamSnippet("decision", summary, snippets)) return;
    persistSseEvent({
      analysisId,
      type: "advisor.thinking",
      payload: {
        phase: "decision",
        title: "Chief Advisor 正在整合最终建议",
        content: summary,
      },
    });
  }
}

function shouldEmitStreamSnippet(key: string, content: string, snippets: Map<string, string>): boolean {
  if (!content) return false;
  const previous = snippets.get(key) ?? "";
  if (previous === content) return false;
  const grewMeaningfully = content.startsWith(previous) && content.length - previous.length >= 16;
  const changedMeaningfully = !content.startsWith(previous);
  if (!grewMeaningfully && !changedMeaningfully && content.length < 48) return false;
  snippets.set(key, content);
  return true;
}

function mergeModelFindings(current: AgentFinding[], modelFindings: AgentFinding[], research: ResearchState): AgentFinding[] {
  const byAgent = new Map<ProfessionalAgentRole, AgentFinding>();
  for (const finding of current) byAgent.set(finding.agent, finding);
  for (const finding of modelFindings) {
    // Market facts come from the verified PandaData call, not model prose.
    // Keep the real-data finding while still executing the model specialist.
    if (finding.agent === "DATA_RESEARCH" && research.executions.length) continue;
    byAgent.set(finding.agent, finding);
  }
  return [...byAgent.values()];
}

function profileCompletenessFor(profile: Profile | undefined, allowAssumptions = false): ProfileCompleteness {
  const missing = allowAssumptions ? [] : profileMissingInformation(profile);
  return { complete: missing.length === 0, missing };
}

function profileMissingInformation(profile: Profile | undefined): string[] {
  const preferences = parsePreferences(profile?.preferences_json);
  return [
    !profile?.risk_level ? "risk_level" : null,
    !profile?.investment_amount_decimal ? "investment_amount" : null,
    !profile?.horizon ? "horizon" : null,
    !profile?.max_drawdown_decimal ? "max_drawdown" : null,
    preferences.instrumentPreference == null || preferences.instrumentPreference === "" ? "instrument_preference" : null,
    preferences.nearTermUse == null ? "near_term_use" : null,
  ].filter((value): value is string => Boolean(value));
}

function buildChiefAdvisorContext(input: {
  input: {
    userId: string;
    sessionId: string;
    analysisId: string;
    content: string;
    workflow?: AdvisorWorkflow;
  };
  profile: Profile | undefined;
  profileCompleteness: ProfileCompleteness;
  goals: Goal[];
  holdings: Holding[];
  snapshot: Record<string, unknown> | undefined;
  target: Instrument | null;
  research: ResearchState;
  findings: AgentFinding[];
  requiredRoles: ProfessionalAgentRole[];
  semanticContext: AdvisorSemanticToolsContext;
  dailyPortfolio: boolean;
}): Record<string, unknown> {
  return {
    workflow: input.dailyPortfolio ? "DAILY_PORTFOLIO" : "CONVERSATION",
    userQuestion: input.input.content,
    profile: input.profile ?? null,
    profileCompleteness: input.profileCompleteness,
    goals: input.goals,
    holdings: input.holdings,
    portfolioSnapshot: input.snapshot ?? null,
    targetInstrument: input.target,
    marketData: {
      dataState: input.research.dataState,
      asOfDate: input.research.asOfDate,
      quotes: input.research.quotes,
      riskMetrics: input.research.riskMetrics,
      correlations: input.research.correlations,
      fundamentalSearch: input.research.fundamentalSearch ?? null,
      study: input.research.study ?? null,
    },
    semanticTools: summarizeAdvisorSemanticToolsContext(input.semanticContext),
    knownFacts: {
      profileIsComplete: input.profileCompleteness.complete,
      missingProfileFields: input.profileCompleteness.missing,
      hasPortfolioSnapshot: Boolean(input.snapshot),
      holdingCount: input.holdings.length,
      requiredRoles: input.requiredRoles,
    },
    missingInformation: [...new Set(input.findings.flatMap((finding) => finding.missingInformation))],
  };
}

function buildChiefConversationContext(input: {
  profile: Profile | undefined;
  profileCompleteness: ProfileCompleteness;
  goals: Goal[];
  holdings: Holding[];
  snapshot: Record<string, unknown> | undefined;
  conversationMessages: string[];
}): Record<string, unknown> {
  return {
    workflow: "CONVERSATION",
    profile: input.profile ?? null,
    profileCompleteness: input.profileCompleteness,
    goals: input.goals,
    portfolioSnapshot: input.snapshot ? {
      id: input.snapshot.id ?? null,
      asOf: input.snapshot.as_of ?? null,
      cash: input.snapshot.cash_decimal ?? null,
      totalMarketValue: input.snapshot.total_market_value_decimal ?? null,
    } : null,
    holdings: input.holdings.map((holding) => ({
      symbol: holding.symbol,
      name: holding.name,
      marketValue: holding.market_value_decimal,
      weightBps: holding.weight_bps,
    })),
    conversationMemory: input.conversationMessages.slice(-8),
    knownFacts: {
      profileIsComplete: input.profileCompleteness.complete,
      missingProfileFields: input.profileCompleteness.missing,
      holdingCount: input.holdings.length,
      professionalAnalysisRequested: false,
    },
  };
}

async function screenInstruments(input: {
  db: ReturnType<typeof getDatabase>;
  analysisId: string;
  content: string;
  conversationMessages: string[];
  profile: Profile | undefined;
  holdings: Holding[];
  snapshot: Record<string, unknown> | undefined;
  instruments: Instrument[];
}): Promise<{
  answer: string;
  provider: ProfessionalAdvisorResult["provider"];
}> {
  const screeningQuestion = [...input.conversationMessages.slice(-6), input.content].join("；");
  const candidates = selectScreeningCandidates(screeningQuestion, input.instruments, input.holdings);
  if (!candidates.length) {
    return {
      answer: "我可以直接帮你筛选，但需要先确定一个候选范围。请只补充一个条件：你更想看宽基或行业 ETF，还是某个明确行业的个股？",
      provider: "DETERMINISTIC_FALLBACK",
    };
  }

  const sources = screeningPandaSources(candidates);
  let executions: PandaSourceExecution[] = [];
  if (sources.length) {
    persistSseEvent({
      analysisId: input.analysisId,
      type: "tool.started",
      payload: { toolName: sources.map((source) => source.method), screening: true, symbolCount: candidates.length },
    });
    try {
      executions = await executePandaSources({
        sources,
        agentRunId: input.analysisId,
        localRows: [],
        db: input.db,
      });
      persistSseEvent({
        analysisId: input.analysisId,
        type: "tool.completed",
        payload: {
          toolName: sources.map((source) => source.method),
          screening: true,
          symbolCount: candidates.length,
          rowCount: executions.reduce((count, execution) => count + execution.result.data.length, 0),
        },
      });
    } catch (error) {
      persistSseEvent({
        analysisId: input.analysisId,
        type: "tool.failed",
        payload: { screening: true, code: "PANDADATA_UNAVAILABLE", message: safeMessage(error) },
      });
    }
  }

  const candidateFacts = buildScreeningCandidateFacts(candidates, executions, input.holdings);
  const context = {
    workflow: "INSTRUMENT_SCREENING",
    profile: input.profile ?? null,
    holdings: input.holdings,
    portfolioSnapshot: input.snapshot ?? null,
    conversationMemory: input.conversationMessages.slice(-8),
    candidates: candidateFacts,
    marketData: {
      verifiedCandidateCount: candidateFacts.filter((candidate) => candidate.verified).length,
      sourceMethods: [...new Set(executions.map((execution) => execution.source.method))],
      dataAsOf: executions.map((execution) => execution.result.asOfDate).filter(Boolean).sort().at(-1) ?? null,
    },
    knownFacts: {
      candidatePool: "受控可交易标的目录",
      maximumResults: 3,
      holdingCount: input.holdings.length,
      screeningIsNotTradeAdvice: true,
    },
  };
  const fallback = deterministicScreeningAnswer(candidateFacts);
  if (!process.env.DEEPSEEK_API_KEY?.trim()) {
    return { answer: fallback, provider: "DETERMINISTIC_FALLBACK" };
  }
  try {
    return await runChiefAdvisorScreening({
      question: input.content,
      context,
    });
  } catch {
    return { answer: fallback, provider: "DETERMINISTIC_FALLBACK" };
  }
}

function selectScreeningCandidates(content: string, instruments: Instrument[], holdings: Holding[]): Instrument[] {
  const upper = content.normalize("NFKC").toUpperCase();
  const sectorTerms = screeningSectorTerms(upper);
  const wantsStock = /个股|股票/u.test(content);
  const wantsFund = /ETF|基金/u.test(upper);
  const heldIds = new Set(holdings.map((holding) => holding.instrument_id));
  const seeksNewPosition = /找|筛选|挑|选|推荐|建仓|布局/u.test(content);
  return instruments
    .filter((instrument) => {
      const assetType = instrument.asset_type.toUpperCase();
      if (wantsStock && !assetType.includes("STOCK")) return false;
      if (wantsFund && !/(?:FUND|ETF|INDEX)/u.test(assetType)) return false;
      if (seeksNewPosition && heldIds.has(instrument.id)) return false;
      const searchable = `${instrument.name} ${instrument.sector ?? ""}`.normalize("NFKC").toUpperCase();
      return sectorTerms.length === 0 || sectorTerms.some((term) => searchable.includes(term));
    })
    .sort((left, right) => {
      const leftScore = screeningCandidateScore(left, sectorTerms);
      const rightScore = screeningCandidateScore(right, sectorTerms);
      return rightScore - leftScore || left.symbol.localeCompare(right.symbol);
    })
    .slice(0, 8);
}

function screeningSectorTerms(content: string): string[] {
  const groups: Array<{ pattern: RegExp; terms: string[] }> = [
    { pattern: /科技|人工智能|\bAI\b|半导体|芯片|软件|计算机|机器人/u, terms: ["TECHNOLOGY", "科技", "人工智能", "半导体", "芯片", "软件", "计算机", "电子", "机器人"] },
    { pattern: /消费|消费电子|食品饮料/u, terms: ["CONSUMER", "消费", "食品饮料"] },
    { pattern: /医药|医疗|生物/u, terms: ["HEALTH", "医药", "医疗", "生物"] },
    { pattern: /金融|银行|证券|保险/u, terms: ["FINANCIAL", "金融", "银行", "证券", "保险"] },
    { pattern: /新能源|电力|能源|光伏|锂电/u, terms: ["ENERGY", "能源", "电力", "光伏", "锂电"] },
  ];
  return [...new Set(groups.filter((group) => group.pattern.test(content)).flatMap((group) => group.terms))];
}

function screeningCandidateScore(instrument: Instrument, sectorTerms: string[]): number {
  const sector = (instrument.sector ?? "").normalize("NFKC").toUpperCase();
  const name = instrument.name.normalize("NFKC").toUpperCase();
  return sectorTerms.reduce((score, term) =>
    score + (sector.includes(term) ? 3 : 0) + (name.includes(term) ? 1 : 0), 0
  );
}

function screeningPandaSources(candidates: Instrument[]): PandaQuerySource[] {
  const endDate = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 180);
  const startDate = start.toISOString().slice(0, 10).replaceAll("-", "");
  const groups = new Map<string, { dataset: PandaQuerySource["dataset"]; method: PandaQuerySource["method"]; assetType: string; symbols: string[] }>();
  for (const candidate of candidates) {
    const source = screeningSourceFor(candidate);
    const key = `${source.dataset}:${source.method}:${source.assetType}`;
    const group = groups.get(key) ?? { ...source, symbols: [] };
    group.symbols.push(pandaSymbol(candidate.symbol, candidate.asset_type, candidate.market));
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    dataset: group.dataset,
    method: group.method,
    parameters: {
      symbol: [...new Set(group.symbols)],
      start_date: startDate,
      end_date: endDate,
      fields: ["symbol", "date", "open", "high", "low", "close", "volume", "amount"],
    },
    columns: ["symbol", "date", "open", "high", "low", "close", "volume", "amount"],
    joinKeys: ["symbol", "date"],
    assetType: group.assetType,
  }));
}

function screeningSourceFor(instrument: Instrument): {
  dataset: PandaQuerySource["dataset"];
  method: PandaQuerySource["method"];
  assetType: string;
} {
  const assetType = instrument.asset_type.toUpperCase();
  const market = instrument.market.toUpperCase();
  if (/(?:FUND|ETF)/u.test(assetType)) return { dataset: "MARKET_FUND_DAILY", method: "get_fund_daily", assetType: "FUND" };
  if (assetType.includes("INDEX")) return { dataset: "MARKET_INDEX_DAILY", method: "get_index_daily", assetType: "INDEX" };
  if (["US", "NASDAQ", "NYSE", "AMEX"].includes(market)) return { dataset: "MARKET_US_DAILY", method: "get_us_daily", assetType: "STOCK" };
  if (market === "HK") return { dataset: "MARKET_HK_DAILY", method: "get_hk_daily", assetType: "STOCK" };
  return { dataset: "MARKET_STOCK_DAILY", method: "get_stock_daily", assetType: "STOCK" };
}

function buildScreeningCandidateFacts(
  candidates: Instrument[],
  executions: PandaSourceExecution[],
  holdings: Holding[],
): Array<Record<string, unknown>> {
  const rows = executions.flatMap((execution) =>
    execution.result.data.map((row) => ({ row, asOfDate: execution.result.asOfDate, method: execution.source.method }))
  );
  const heldIds = new Set(holdings.map((holding) => holding.instrument_id));
  return candidates.map((candidate) => {
    const candidateRows = rows
      .filter(({ row }) => symbolBase(String(row.symbol ?? "")) === symbolBase(candidate.symbol))
      .sort((left, right) => marketRowDate(left.row).localeCompare(marketRowDate(right.row)));
    const closes = candidateRows.map(({ row }) => decimal(row.close)).filter((value): value is Decimal => value !== null);
    const first = closes[0] ?? null;
    const latest = closes.at(-1) ?? null;
    return {
      instrumentId: candidate.id,
      symbol: candidate.symbol,
      name: candidate.name,
      market: candidate.market,
      assetType: candidate.asset_type,
      sector: candidate.sector ?? null,
      alreadyHeld: heldIds.has(candidate.id),
      verified: closes.length > 0,
      observations: closes.length,
      latest: latest?.toString() ?? null,
      periodReturn: first?.gt(0) && latest ? latest.div(first).minus(1).toDecimalPlaces(6).toString() : null,
      annualizedVolatility: annualizedVolatility(closes)?.toDecimalPlaces(6).toString() ?? null,
      maxDrawdown: maximumDrawdown(closes)?.toDecimalPlaces(6).toString() ?? null,
      asOfDate: candidateRows.map((item) => item.asOfDate).filter(Boolean).sort().at(-1) ?? null,
      sourceMethod: candidateRows[0]?.method ?? null,
    };
  });
}

function deterministicScreeningAnswer(candidates: Array<Record<string, unknown>>): string {
  const selected = [...candidates]
    .sort((left, right) => Number(Boolean(right.verified)) - Number(Boolean(left.verified)))
    .slice(0, 3);
  if (!selected.length) return "当前受控候选池中没有匹配标的。请换一个行业或资产类型，我再继续筛选。";
  return [
    "我先从受控可交易标的目录中筛出以下研究候选。它们不是直接买入结论，选中后还要做基本面、估值、组合冲突和合规检查。",
    ...selected.map((candidate, index) => {
      const verified = candidate.verified
        ? `已核验 ${candidate.observations} 个行情样本，数据截至 ${formatMarketDate(String(candidate.asOfDate ?? ""))}`
        : "行情服务暂未返回有效样本，需要在下一步补充核验";
      const volatility = candidate.annualizedVolatility
        ? `，历史年化波动约 ${formatRatioAsPercent(String(candidate.annualizedVolatility))}`
        : "";
      return `${index + 1}. ${candidate.name}（${candidate.symbol}）：${verified}${volatility}。值得继续看：属于 ${candidate.sector ?? "目标方向"}；需要警惕：候选筛选尚未覆盖完整估值和财务质量。`;
    }),
    "你可以直接回复其中一个名称或代码，我会立即进入完整分析，不再重复询问已经知道的画像和资金信息。",
  ].join("\n");
}

function formatAdvisorConversationFallback(question: string, profileCompleteness: ProfileCompleteness): string {
  if (/^(?:你好|您好|嗨|哈喽|hello|hi)[！!。.\s]*$/iu.test(question.trim())) {
    return "你好，我是你的理财顾问。我们可以先聊你最近最想解决的一件事，比如怎么安排存款、设定目标、理解风险，或者看懂现有持仓。";
  }
  if (!profileCompleteness.complete) {
    return "我明白你的顾虑。我们先不急着谈买卖，我会一步一步帮你梳理。先告诉我一个最关键的信息：这笔钱大概多久不会使用？";
  }
  return "我明白你的意思。我们先围绕你当前最关心的问题聊清楚，不急着启动持仓诊断或给出买卖结论。你可以再说说，最近最困扰你的是资金安排、波动焦虑，还是某个具体目标？";
}

function profileFindingFor(profile: Profile | undefined, allowAssumptions = false): AgentFinding {
  const missing = profileMissingInformation(profile);
  return AgentFindingSchema.parse({
    agent: "PROFILE_CONTEXT",
    conclusion: missing.length && !allowAssumptions
      ? "用户画像仍缺少影响适配性的关键信息"
      : allowAssumptions && missing.length
        ? "已加载现有画像；对缺失字段采用仅用于本次组合建议的保守默认假设"
        : "已加载风险等级、投资金额、期限和最大回撤约束",
    supportEvidence: allowAssumptions && missing.length
      ? ["默认假设：平衡型、中线、最大回撤 10%、偏好宽基 ETF、近期不使用"]
      : missing.length ? [] : formatProfileFacts(profile).slice(0, 3),
    counterEvidence: [missing.length ? "缺失画像会使仓位和期限建议失真" : "画像可能随资金用途变化，需要在执行前复核"],
    missingInformation: allowAssumptions ? [] : missing,
    risks: ["近期资金用途变化会降低风险承受能力"],
    confidence: missing.length ? 0.35 : 0.9,
    needsAnotherAgent: true,
    suggestedNextAgent: "PORTFOLIO_RISK",
  });
}

async function researchInstrument(
  db: ReturnType<typeof getDatabase>,
  rootRunId: string,
  childRunId: string,
  target: Instrument | null,
  holdings: Holding[],
  intent: AdvisorIntent,
  content: string,
): Promise<{ finding: AgentFinding; state: ResearchState }> {
  const instruments = target ? [target] : holdings.map((holding) => ({
    id: holding.instrument_id,
    symbol: holding.symbol,
    name: holding.name,
    asset_type: holding.asset_type,
    market: marketForHolding(holding),
  }));
  if (!instruments.length) return {
    state: { dataState: "UNAVAILABLE", executions: [], closes: [], latest: null, asOfDate: null, quotes: [], riskMetrics: [], correlations: [] },
    finding: AgentFindingSchema.parse({
      agent: "DATA_RESEARCH", conclusion: isResearchStudy(intent) ? "未识别到可研究标的，无法执行研究任务" : "未识别到可研究标的", supportEvidence: [], counterEvidence: ["没有明确标的时不能形成个股买卖结论"],
      missingInformation: ["instrument"], risks: ["标的歧义可能导致错误数据关联"], confidence: 0.2, needsAnotherAgent: false,
    }),
  };
  const end = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - 180);
  const sources = instruments.map((instrument): PandaQuerySource => {
    if (intent === "FACTOR_RESEARCH") {
      const symbol = pandaSymbol(instrument.symbol, instrument.asset_type, instrument.market);
      return {
        dataset: "FACTOR_STOCK",
        method: "get_factor",
        parameters: {
          symbol: [symbol],
          start_date: startDate.toISOString().slice(0, 10).replaceAll("-", ""),
          end_date: end,
          factors: factorNames(content),
          type: "stock",
        },
        columns: ["symbol", "date", ...factorNames(content)],
        joinKeys: ["symbol", "date"],
        assetType: "STOCK",
      };
    }
    const method = marketMethod(instrument);
    const symbol = pandaSymbol(instrument.symbol, instrument.asset_type, instrument.market);
    const realtime = method === "get_stock_rt_daily";
    const columns = ["symbol", "date", "open", "high", "low", "close", "volume", "amount", "num_trades"];
    return {
      dataset: marketDataset(instrument),
      method,
      parameters: realtime
        ? { symbol, fields: columns }
        : { symbol: [symbol], start_date: startDate.toISOString().slice(0, 10).replaceAll("-", ""), end_date: end, fields: columns },
      columns,
      joinKeys: ["symbol", "date"],
      assetType: instrument.asset_type.toUpperCase(),
    };
  });
  let usedDailyFallback = false;
  let latestTradingDate: string | null = null;
  persistSseEvent({ analysisId: rootRunId, type: "tool.started", payload: { toolName: sources.map((source) => source.method), childRunId, symbolCount: sources.length } });
  try {
    let executions = await executePandaSources({ sources, agentRunId: childRunId, localRows: [], db });
    // PandaData's real-time endpoint legitimately returns no rows outside a
    // trading session. Validate the daily fallback against PandaData's
    // official exchange calendar before allowing the daily workflow to use it.
    const staleSources = sources.filter((source, index) => source.method === "get_stock_rt_daily" && executions[index]?.result.data.length === 0)
      .map((source) => ({
        ...source,
        dataset: "MARKET_STOCK_DAILY" as const,
        method: "get_stock_daily" as const,
        parameters: {
          symbol: source.parameters.symbol,
          start_date: startDate.toISOString().slice(0, 10).replaceAll("-", ""),
          end_date: end,
          fields: source.parameters.fields,
        },
    }));
    if (staleSources.length) {
      usedDailyFallback = true;
      const [fallbackExecutions, calendar] = await Promise.all([
        executePandaSources({ sources: staleSources, agentRunId: childRunId, localRows: [], db }),
        callPandaData("get_last_trade_date", { exchange: "SH" }).catch(() => null),
      ]);
      latestTradingDate = calendar?.asOfDate ?? null;
      executions = executions.map((execution, index) => {
        const fallback = staleSources.findIndex((source) => source.parameters.symbol === sources[index]?.parameters.symbol);
        return execution.result.data.length === 0 && fallback >= 0 ? fallbackExecutions[fallback] : execution;
      });
    }
    const allRows = executions.flatMap((execution) => execution.result.data).sort(compareMarketRows);
    const closes = allRows.map((row) => decimal(row.close)).filter((value): value is Decimal => value !== null);
    const latest = closes.at(-1) ?? null;
    const series = executions.map(marketSeries);
    const riskMetrics = series.map((item) => ({
      symbol: item.symbol,
      observations: item.points.length,
      annualizedVolatility: annualizedVolatility(item.points.map((point) => point.close))?.toDecimalPlaces(6).toString() ?? null,
      maxDrawdown: maximumDrawdown(item.points.map((point) => point.close))?.toDecimalPlaces(6).toString() ?? null,
    }));
    const correlations = pairwiseCorrelations(series);
    const dataState = classifyResearchDataState(executions, usedDailyFallback, latestTradingDate);
    const asOfDates = executions.map((execution) => execution.result.asOfDate).filter((value): value is string => Boolean(value)).sort();
    const quotes = executions.map((execution) => {
      const symbol = String(execution.source.parameters.symbol instanceof Array ? execution.source.parameters.symbol[0] : execution.source.parameters.symbol ?? execution.source.dataset);
      const instrument = instruments.find((candidate) => normalizeSymbol(candidate.symbol) === normalizeSymbol(symbol));
      return {
        symbol,
        name: instrument?.name ?? symbol,
        latest: [...execution.result.data].sort(compareMarketRows).map((row) => decimal(row.close)).filter((value): value is Decimal => value !== null).at(-1)?.toString() ?? null,
        asOfDate: execution.result.asOfDate,
        method: execution.source.method,
      };
    });
    const study = intent === "FACTOR_RESEARCH"
      ? factorStudy(executions, factorNames(content))
      : intent === "STRATEGY_BACKTEST"
        ? strategyStudy(executions, content)
        : undefined;
    const studyMissing = study?.missing ?? [];
    const studySummary = study?.summary;
    persistSseEvent({ analysisId: rootRunId, type: "tool.completed", payload: { toolName: sources.map((source) => source.method), childRunId, rowCount: allRows.length, dataState, symbolCount: executions.length } });
    return {
      state: { dataState, executions, closes, latest, asOfDate: asOfDates.at(-1) ?? null, quotes, riskMetrics, correlations, study },
      finding: AgentFindingSchema.parse({
        agent: "DATA_RESEARCH",
        conclusion: studySummary ?? `行情数据已完成核对，并完成历史波动和最大回撤计算（截至 ${formatMarketDate(asOfDates.at(-1) ?? null)}）`,
        supportEvidence: [
          `行情数据截至：${asOfDates.at(-1) ?? "未知"}`,
          studySummary ?? "已取得行情收盘价，并计算历史波动和最大回撤。",
        ].slice(0, 3),
        counterEvidence: [
          dataState === "LIVE_FRESH"
            ? "历史价格不能保证未来走势"
            : dataState === "LATEST_TRADING_DAY"
              ? "当前为非交易时段，已使用同一数据源最近官方交易日数据；实际执行时仍需复核开盘价格"
              : usedDailyFallback
                ? "日线日期与官方最近交易日不一致，需要刷新后再确认"
                : "行情数据需要刷新后再确认",
        ],
        missingInformation: [...(latest ? [] : ["close"]), ...studyMissing],
        risks: ["短期价格和成交量可能快速变化", "财务或估值字段缺失时不会推导替代值"],
        confidence: latest && (dataState === "LIVE_FRESH" || dataState === "LATEST_TRADING_DAY") ? 0.82 : 0.4,
        needsAnotherAgent: true,
        suggestedNextAgent: "PORTFOLIO_RISK",
      }),
    };
  } catch (error) {
    const unavailableStudy = intent === "FACTOR_RESEARCH"
      ? factorStudy([], factorNames(content))
      : intent === "STRATEGY_BACKTEST"
        ? strategyStudy([], content)
        : undefined;
    persistSseEvent({ analysisId: rootRunId, type: "tool.failed", payload: { toolName: sources.map((source) => source.method), childRunId, code: "PANDADATA_UNAVAILABLE" } });
    return {
      state: { dataState: "UNAVAILABLE", executions: [], closes: [], latest: null, asOfDate: null, quotes: [], riskMetrics: [], correlations: [], study: unavailableStudy },
      finding: AgentFindingSchema.parse({
        agent: "DATA_RESEARCH", conclusion: `${unavailableStudy?.summary ?? `${target?.symbol ?? instruments.map((instrument) => instrument.symbol).join("、")} 的 PandaData live call 不可用`}；真实数据调用失败，保留研究边界并阻断发布`, supportEvidence: unavailableStudy ? [unavailableStudy.summary] : [],
        counterEvidence: [`真实行情处理失败：${safeMessage(error)}`], missingInformation: unavailableStudy?.missing ?? [],
        risks: ["缺少新鲜行情时参考区间和触发价不可执行"], confidence: 0.2, needsAnotherAgent: true, suggestedNextAgent: "COMPLIANCE_REVIEWER",
      }),
    };
  }
}

function portfolioRiskFinding(holdings: Holding[], snapshot: Record<string, unknown> | undefined, research: ResearchState): AgentFinding {
  const values = holdings.map((holding) => decimal(holding.market_value_decimal) ?? new Decimal(0));
  const invested = Decimal.sum(...(values.length ? values : [new Decimal(0)]));
  const weights = invested.gt(0) ? values.map((value) => value.div(invested)) : [];
  const largest = weights.reduce((current, value) => Decimal.max(current, value), new Decimal(0));
  const hhi = weights.reduce((sum, weight) => sum.plus(weight.pow(2)), new Decimal(0));
  const volatilitySummary = research.riskMetrics
    .map((item) => `${item.symbol} 年化波动率 ${item.annualizedVolatility ?? "不可计算"}、最大回撤 ${item.maxDrawdown ?? "不可计算"}（${item.observations} 个样本）`)
    .join("；");
  const correlationSummary = research.correlations
    .map((item) => `${item.left}/${item.right}=${item.value ?? "不可计算"}（${item.observations} 个重合样本）`)
    .join("；");
  return AgentFindingSchema.parse({
    agent: "PORTFOLIO_RISK",
    conclusion: holdings.length ? `组合非现金持仓 ${holdings.length} 项，最大持仓权重 ${largest.mul(100).toDecimalPlaces(2).toString()}%，HHI ${hhi.toDecimalPlaces(4).toString()}；已计算 ${research.riskMetrics.length} 个标的的历史风险指标` : "当前没有可用于组合风险计算的持仓",
    supportEvidence: holdings.length ? [
      `组合快照：${String(snapshot?.id ?? "未知")}；集中度计算明确排除现金`,
      volatilitySummary || "历史行情不足，未形成波动率和最大回撤指标",
      correlationSummary || "当前只有一个可计算收益序列，不需要跨标的相关性",
    ] : [],
    counterEvidence: [holdings.length ? "当前历史窗口不能覆盖未来极端行情和结构性变化" : "缺少持仓时不能评估卖出影响"],
    missingInformation: holdings.length ? research.riskMetrics.length ? [] : ["historical_market_series"] : ["holdings"],
    risks: [largest.gte("0.5") ? "单一持仓波动可能主导组合回撤" : "行业相关性仍可能放大组合波动"],
    confidence: holdings.length && research.riskMetrics.length ? 0.86 : holdings.length ? 0.62 : 0.2,
    needsAnotherAgent: true,
    suggestedNextAgent: "RECOMMENDATION",
  });
}

export function classifyResearchDataState(
  executions: Array<Pick<PandaSourceExecution, "result" | "source">>,
  usedDailyFallback: boolean,
  latestTradingDate: string | null = null,
): DataState {
  const hasRows = executions.some((execution) => execution.result.data.length > 0);
  if (!hasRows) return "UNAVAILABLE";
  const fullyFresh = executions.every((execution) =>
    execution.result.liveCallSucceeded
    && execution.result.data.length > 0
    && execution.result.fresh
  );
  if (!fullyFresh) return "STALE";
  if (!usedDailyFallback) return "LIVE_FRESH";
  const fallbackExecutions = executions.filter((execution) => execution.source.method === "get_stock_daily");
  const latestFallback = Boolean(latestTradingDate)
    && fallbackExecutions.length > 0
    && fallbackExecutions.every((execution) => execution.result.asOfDate === latestTradingDate);
  return latestFallback ? "LATEST_TRADING_DAY" : "STALE";
}

export function deterministicAdvisorSummary(input: {
  targetSymbol: string | null;
  profileReady: boolean;
  hasHoldings: boolean;
  concentrationRisk: boolean;
}): string {
  if (input.targetSymbol) {
    return `${input.targetSymbol} 需要在画像、真实数据、组合风险和合规条件下进行条件化决策`;
  }
  if (!input.profileReady && !input.hasHoldings) {
    return "请先完成投资画像并补充当前持仓，再形成具体标的建议";
  }
  if (!input.profileReady) {
    return "请先完成投资画像，再继续组合诊断";
  }
  if (!input.hasHoldings) {
    return "请先补充当前持仓，完成组合诊断后再形成具体标的建议";
  }
  if (input.concentrationRisk) {
    return "已完成画像与组合诊断，当前应暂停加仓并优先降低集中度";
  }
  return "已完成画像与组合诊断，当前组合以继续观察为主";
}

function factorNames(content: string): string[] {
  const supported = ["open", "close", "high", "low", "volume", "amount", "market_cap", "turnover"];
  const requested = content.toLowerCase().match(/\b(?:open|close|high|low|volume|amount|market_cap|turnover)\b/gu) ?? [];
  const translated = /成交量/u.test(content) ? ["volume"] : [];
  const names = [...new Set([...requested, ...translated].filter((name) => supported.includes(name)))];
  return names.length ? names : ["close", "volume", "turnover"];
}

function factorStudy(executions: PandaSourceExecution[], factors: string[]): ResearchStudy {
  const rows = executions.reduce((count, execution) => count + execution.result.data.length, 0);
  const summaries = factors.flatMap((factor) => {
    const values = executions.flatMap((execution) => execution.result.data.map((row) => decimal(row[factor]))).filter((value): value is Decimal => value !== null);
    if (!values.length) return [];
    const mean = Decimal.sum(...values).div(values.length).toDecimalPlaces(4).toString();
    const low = values.reduce((current, value) => Decimal.min(current, value));
    const high = values.reduce((current, value) => Decimal.max(current, value));
    return [`${factor}：样本 ${values.length}，均值 ${mean}，区间 ${low.toDecimalPlaces(4).toString()}~${high.toDecimalPlaces(4).toString()}`];
  });
  const missing = rows && summaries.length ? [] : ["factor_data"];
  return {
    kind: "FACTOR_RESEARCH",
    factors,
    rows,
    summary: rows && summaries.length
      ? `因子研究已通过 PandaData get_factor 获取 ${rows} 行 ${factors.join("、")} 数据；${summaries.join("；")}。单标的样本不等于横截面 IC/Rank IC。`
      : "PandaData get_factor 未返回可计算的因子样本，不能声称已完成因子评价。",
    missing,
  };
}

function strategyStudy(executions: PandaSourceExecution[], content: string): ResearchStudy {
  const execution = executions.find((candidate) => candidate.result.data.some((row) => decimal(row.close) !== null));
  const points = execution?.result.data
    .sort(compareMarketRows)
    .flatMap((row) => {
      const close = decimal(row.close);
      return close && close.gt(0) ? [close] : [];
    }) ?? [];
  const strategy = /均线|移动平均/u.test(content) ? "20日均线择时" : /动量|趋势/u.test(content) ? "20日动量择时" : "20日均线择时（默认规则）";
  if (points.length < 22) {
    return { kind: "STRATEGY_BACKTEST", strategy, observations: points.length, trades: 0, totalReturn: null, buyAndHoldReturn: null, maxDrawdown: null, summary: `策略回测需要至少 22 个有效收盘样本；当前只有 ${points.length} 个，未生成收益结论。`, missing: ["historical_market_series"] };
  }
  const lookback = 20;
  const portfolio = [new Decimal(1)];
  const buyAndHold = [new Decimal(1)];
  let previousSignal = false;
  let trades = 0;
  for (let index = lookback + 1; index < points.length; index += 1) {
    const movingAverage = Decimal.sum(...points.slice(index - lookback - 1, index - 1)).div(lookback);
    const signal = points[index - 1].gt(movingAverage);
    if (signal !== previousSignal) trades += 1;
    const dailyReturn = points[index].div(points[index - 1]).minus(1);
    const transactionCost = signal !== previousSignal ? new Decimal("0.001") : new Decimal(0);
    portfolio.push(portfolio.at(-1)!.mul(signal ? dailyReturn.plus(1).minus(transactionCost) : 1));
    buyAndHold.push(buyAndHold.at(-1)!.mul(dailyReturn.plus(1)));
    previousSignal = signal;
  }
  const totalReturn = portfolio.at(-1)!.minus(1);
  const buyAndHoldReturn = buyAndHold.at(-1)!.minus(1);
  const drawdown = maximumDrawdown(portfolio);
  return {
    kind: "STRATEGY_BACKTEST",
    strategy,
    observations: portfolio.length - 1,
    trades,
    totalReturn: percentDecimal(totalReturn),
    buyAndHoldReturn: percentDecimal(buyAndHoldReturn),
    maxDrawdown: drawdown ? percentDecimal(drawdown.negated()) : null,
    summary: `${strategy}已用 ${portfolio.length - 1} 个样本完成确定性回测：策略收益 ${percentDecimal(totalReturn)}，买入并持有 ${percentDecimal(buyAndHoldReturn)}，最大回撤 ${drawdown ? percentDecimal(drawdown.negated()) : "不可计算"}，换手信号 ${trades} 次；已计入单次 0.1% 成交成本，未处理涨跌停和滑点。`,
    missing: [],
  };
}

function percentDecimal(value: Decimal): string {
  return `${value.mul(100).toDecimalPlaces(2).toString()}%`;
}

function deterministicDecisionFor(input: {
  intent: AdvisorIntent;
  requestedDirection: AdvisorDecision["requestedDirection"];
  target: Instrument | null;
  targetHolding: Holding | null;
  profileReady: boolean;
  hasHoldings: boolean;
  research: ResearchState;
  riskFinding: AgentFinding;
}): AdvisorDecision {
  const concentrationRisk = input.riskFinding.risks.some((risk) => risk.includes("单一持仓波动可能主导组合回撤"));
  const action: AdvisorDecision["action"] = input.intent === "BUY"
    ? input.targetHolding ? "SCALE_IN" : input.target ? "TRIAL_BUY" : "WATCH"
    : input.intent === "SELL"
      ? input.targetHolding ? "SCALE_OUT" : "HOLD"
      : input.targetHolding ? "HOLD" : concentrationRisk ? "STOP_ADDING" : "WATCH";
  return AdvisorDecisionSchema.parse({
    action,
    requestedDirection: input.requestedDirection,
    summary: deterministicAdvisorSummary({
      targetSymbol: input.target?.symbol ?? null,
      profileReady: input.profileReady,
      hasHoldings: input.hasHoldings,
      concentrationRisk,
    }),
    suitability: "MEDIUM",
    confidence: input.research.dataState === "LIVE_FRESH" || input.research.dataState === "LATEST_TRADING_DAY" ? 0.72 : 0.4,
    rationales: [input.riskFinding.conclusion, input.research.latest ? `最新市场价格 ${input.research.latest.toString()}` : "市场数据不可用时仅保留方向"],
    counterEvidence: [
      input.research.dataState === "LIVE_FRESH"
        ? "历史行情不能保证未来走势"
        : input.research.dataState === "LATEST_TRADING_DAY"
          ? "建议基于最近官方收盘数据，实际执行时需复核开盘价格"
          : "缺少新鲜真实行情，不能形成可执行建议",
    ],
    risks: ["市场波动可能使参考区间快速失效", "画像或资金用途变化会改变适配性"],
    portfolioImpact: input.targetHolding ? `当前标的权重为 ${new Decimal(input.targetHolding.weight_bps).div(100).toString()}%，执行后必须重算组合与压力测试` : "新增标的会改变现金、集中度和压力损失，执行前必须模拟",
    invalidationConditions: ["画像或持仓发生变化", "数据过期或数据源不可用", "投资逻辑或合规结论发生变化"],
    compliance: { approved: false, decision: "DOWNGRADED", reason: "确定性 fallback 只提出候选，发布状态由服务端计算" },
    debateSuggestion: {
      recommended: false,
      motion: "当前问题暂不适合进入多空 Battle",
      reason: "确定性候选没有足够的语义判断，先由顾问完成结构化分析。",
    },
  });
}

function recommendationFinding(decision: AdvisorDecision, findings: AgentFinding[]): AgentFinding {
  return AgentFindingSchema.parse({
    agent: "RECOMMENDATION", conclusion: `${decision.requestedDirection} 方向候选动作：${decision.action}`,
    supportEvidence: findings.flatMap((finding) => finding.supportEvidence).slice(0, 3),
    counterEvidence: findings.flatMap((finding) => finding.counterEvidence).slice(0, 3),
    missingInformation: findings.flatMap((finding) => finding.missingInformation),
    risks: decision.risks,
    confidence: decision.confidence,
    needsAnotherAgent: true,
    suggestedNextAgent: "COMPLIANCE_REVIEWER",
  });
}

function complianceFindingFor(
  criticalMissing: string[],
  dataState: DataState,
  findings: AgentFinding[],
  latestTradingDayAllowed = false,
): AgentFinding {
  const blocked = criticalMissing.length > 0;
  const degraded = dataState === "STALE"
    || dataState === "UNAVAILABLE"
    || (dataState === "LATEST_TRADING_DAY" && !latestTradingDayAllowed);
  return AgentFindingSchema.parse({
    agent: "COMPLIANCE_REVIEWER",
    conclusion: blocked ? "存在必须先确认的关键输入" : degraded ? "市场数据条件不满足，暂不能形成交易动作" : "画像、市场证据、组合影响和动作边界检查完成",
    supportEvidence: [`已检查 ${findings.length} 个专业节点`, `市场数据状态：${dataState}`],
    counterEvidence: [blocked ? `待确认：${criticalMissing.join(", ")}` : degraded ? "市场数据恢复后需要重新计算" : "市场变化可能使当前结论和触发条件失效"],
    missingInformation: criticalMissing,
    risks: ["采纳前仍需复核最新价格、资金用途和组合约束"],
    confidence: 0.95,
    needsAnotherAgent: false,
  });
}

function explanationReportFinding(findings: AgentFinding[]): AgentFinding {
  const strongest = findings
    .filter((finding) => finding.agent !== "EXPLANATION_REPORT")
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);
  const missing = [...new Set(findings.flatMap((finding) => finding.missingInformation))];
  return AgentFindingSchema.parse({
    agent: "EXPLANATION_REPORT",
    conclusion: strongest.length
      ? `已将 ${strongest.map((finding) => finding.agent).join("、")} 的发现整理为可回溯报告`
      : "没有足够发现可整理为报告",
    supportEvidence: strongest.flatMap((finding) => finding.supportEvidence).slice(0, 3),
    counterEvidence: findings.flatMap((finding) => finding.counterEvidence).slice(0, 3),
    missingInformation: missing,
    risks: ["解释层只汇总已持久化发现，不替代服务端发布门"],
    confidence: strongest.length ? Math.min(...strongest.map((finding) => finding.confidence)) : 0.2,
    needsAnotherAgent: false,
  });
}

export function enforcePublicationStatus(input: {
  candidate: AdvisorDecision;
  criticalMissing: string[];
  dataState: DataState;
  findings: AgentFinding[];
  modelFallback: boolean;
  unresolvedConflict: boolean;
  marketDataRequired: boolean;
  decisionIntegrity?: ChiefAdvisorDecisionIntegrity;
  latestTradingDayAllowed?: boolean;
}): PublicationStatus {
  if (input.criticalMissing.length || input.candidate.compliance.decision === "BLOCKED" || input.unresolvedConflict) return "BLOCKED";
  const currentMarketData = input.dataState === "LIVE_FRESH"
    || (input.latestTradingDayAllowed && input.dataState === "LATEST_TRADING_DAY");
  if (input.marketDataRequired && !currentMarketData) return "BLOCKED";
  if (input.candidate.compliance.decision !== "APPROVED") return "DEGRADED";
  const hasCounterEvidence = input.findings.some((finding) => finding.counterEvidence.length > 0) && input.candidate.counterEvidence.length > 0;
  const hasPortfolioImpact = input.candidate.portfolioImpact.trim().length > 0;
  const dataRequirementSatisfied = currentMarketData || (!input.marketDataRequired && input.dataState === "NOT_REQUIRED");
  const decisionComplete = input.decisionIntegrity?.complete ?? true;
  if (!input.modelFallback && decisionComplete && dataRequirementSatisfied && hasCounterEvidence && hasPortfolioImpact && input.candidate.compliance.approved) return "ACTIVE";
  return "DEGRADED";
}

function publicationSafetyReasons(candidate: AdvisorDecision): string[] {
  const reasons: string[] = [];
  if (candidate.compliance.decision !== "APPROVED") {
    reasons.push(candidate.compliance.reason);
  } else if (!candidate.compliance.approved) {
    reasons.push(candidate.compliance.reason);
  }
  return [...new Set(reasons)];
}

function preserveDirection(model: AdvisorDecision, fallback: AdvisorDecision): { decision: AdvisorDecision; conflict: boolean } {
  const expected = fallback.requestedDirection;
  const allowed = actionMatchesDirection(model.action, expected);
  const sameDirection = model.requestedDirection === expected;
  if (allowed && sameDirection) {
    return {
      decision: fallback.action === "STOP_ADDING" && model.action !== "STOP_ADDING" ? { ...model, action: "STOP_ADDING" } : model,
      conflict: false,
    };
  }
  return { decision: { ...model, action: fallback.action, requestedDirection: expected, summary: fallback.summary }, conflict: false };
}

function buildRecommendationDraft(input: {
  status: PublicationStatus;
  candidate: AdvisorDecision;
  target: Instrument;
  holding: Holding | null;
  profile: Profile | undefined;
  assumptions?: string[];
  research: ResearchState;
  snapshot: Record<string, unknown> | undefined;
}): RecommendationDraft {
  const maxDrawdown = decimal(input.profile?.max_drawdown_decimal) ?? new Decimal("0.1");
  const volatility = annualizedVolatility(input.research.closes);
  const riskBudget = maxDrawdown.mul("0.25");
  const maxWeight = volatility?.gt(0) ? Decimal.min(new Decimal(1), riskBudget.div(volatility)) : null;
  const firstWeight = maxWeight?.div(3);
  const currentWeight = input.holding ? new Decimal(input.holding.weight_bps).div(10_000) : new Decimal(0);
  const reduction = input.candidate.requestedDirection === "SELL" && currentWeight.gt(0) && maxWeight
    ? Decimal.max(0, currentWeight.minus(maxWeight)).div(currentWeight)
    : null;
  const latest = input.research.latest;
  const recent = input.research.closes.slice(-20);
  const lower = recent.length ? recent.reduce((value, item) => Decimal.min(value, item)) : null;
  const upper = recent.length ? recent.reduce((value, item) => Decimal.max(value, item)) : null;
  const stop = latest?.mul(new Decimal(1).minus(maxDrawdown));
  const take = latest?.mul(new Decimal(1).plus(maxDrawdown.mul("1.5")));
  const horizon = normalizeHorizon(input.profile?.horizon);
  const validUntil = new Date();
  validUntil.setUTCDate(validUntil.getUTCDate() + (horizon === "SHORT" ? 7 : horizon === "LONG" ? 90 : 30));
  return {
    instrumentId: input.target.id,
    symbol: input.target.symbol,
    action: input.candidate.action,
    suitability: input.status === "ACTIVE" ? input.candidate.suitability : "LOW",
    summary: input.candidate.summary,
    confidence: new Decimal(input.status === "ACTIVE" ? input.candidate.confidence : Math.min(input.candidate.confidence, 0.45)).toString(),
    positionRange: maxWeight ? ["0%", percent(maxWeight)] : ["需要完成波动率计算后确定"],
    firstPosition: input.candidate.requestedDirection === "BUY" && firstWeight ? percent(firstWeight) : null,
    addConditions: ["PandaData live 数据保持新鲜", "重新计算后组合风险不超过用户最大回撤约束", "反方证据没有恶化"],
    referenceRange: lower && upper ? [lower.toString(), upper.toString()] : ["数据不可用，暂不提供价格区间"],
    stopLoss: stop ? `价格低于 ${stop.toDecimalPlaces(4).toString()} 或投资逻辑失效` : "数据恢复后计算价格条件；投资逻辑失效时停止行动",
    takeProfit: take ? `价格达到 ${take.toDecimalPlaces(4).toString()}、估值过热或组合需要再平衡` : "达到目标收益、估值过热或组合需要再平衡",
    horizon,
    expiresAt: validUntil.toISOString(),
    reasons: [
      ...(input.assumptions?.length ? [`本次使用默认画像假设：${input.assumptions.join("；")}`] : []),
      ...input.candidate.rationales,
    ].slice(0, 3),
    counterEvidence: input.candidate.counterEvidence,
    risks: input.candidate.risks,
    alternatives: ["宽基 ETF", "低波动资产", "继续持有现金"],
    invalidation: input.candidate.invalidationConditions.join("；"),
    compliance: {
      status: input.status === "ACTIVE" ? "PASSED" : input.status,
      reasons: [input.candidate.compliance.reason, ...(input.status === "DEGRADED" ? [`数据状态：${input.research.dataState}`] : [])],
      disclaimer: "本结果仅用于投资研究和方案模拟，不连接券商，不创建真实订单。",
    },
    dataAsOf: input.research.asOfDate ?? String(input.snapshot?.as_of ?? isoNow()),
    provenance: {
      engine: "professional-chief-advisor-v2",
      publicationStatus: input.status,
      dataState: input.research.dataState,
      snapshotId: input.snapshot?.id ?? null,
      formulaVersion: "advisor-allocation-risk-budget-v1",
      annualizedVolatility: volatility?.toString() ?? null,
      currentWeight: currentWeight.toString(),
      recommendationScope: "INSTRUMENT",
      suggestedReduction: reduction?.toString() ?? null,
      modelCannotOverridePublicationGate: true,
      assumptions: input.assumptions ?? [],
    },
  };
}

export function buildPortfolioRecommendationDraft(input: {
  status: PublicationStatus;
  candidate: AdvisorDecision;
  profile: Profile | undefined;
  assumptions?: string[];
  holdings: Holding[];
  research: ResearchState;
  snapshot: Record<string, unknown> | undefined;
}): RecommendationDraft {
  const maxDrawdown = decimal(input.profile?.max_drawdown_decimal) ?? new Decimal("0.1");
  const investedValue = input.holdings.reduce(
    (sum, holding) => sum.plus(decimal(holding.market_value_decimal) ?? 0),
    new Decimal(0),
  );
  const cash = decimal(input.snapshot?.cash_decimal) ?? new Decimal(0);
  const totalAssets = investedValue.plus(cash);
  const investedRatio = totalAssets.gt(0) ? investedValue.div(totalAssets) : new Decimal(0);
  const largestWeight = input.holdings.reduce(
    (largest, holding) => Decimal.max(largest, new Decimal(holding.weight_bps).div(10_000)),
    new Decimal(0),
  );
  const horizon = normalizeHorizon(input.profile?.horizon);
  const validUntil = new Date();
  validUntil.setUTCDate(validUntil.getUTCDate() + (horizon === "SHORT" ? 7 : horizon === "LONG" ? 90 : 30));
  const headline = input.status === "BLOCKED"
    ? "关键行情数据不可用，今日暂不调整组合"
    : input.candidate.summary;
  const reasons = [...new Set([
    ...(input.assumptions?.length ? [`本次使用默认画像假设：${input.assumptions.join("；")}`] : []),
    ...(headline === input.candidate.summary ? [] : [input.candidate.summary]),
    ...input.candidate.rationales,
  ])].slice(0, 3);
  return {
    instrumentId: null,
    symbol: null,
    action: input.candidate.action,
    suitability: input.status === "ACTIVE" ? input.candidate.suitability : "LOW",
    summary: headline,
    confidence: new Decimal(input.status === "ACTIVE" ? input.candidate.confidence : Math.min(input.candidate.confidence, 0.45)).toString(),
    positionRange: [percent(investedRatio), percent(investedRatio)],
    firstPosition: input.status === "BLOCKED" ? "今日不调整；数据恢复后重新评估" : null,
    addConditions: [
      "用户画像、资金用途与持仓没有发生重大变化",
      "组合压力测试仍处于最大可接受回撤以内",
      "反方证据没有明显恶化",
    ],
    referenceRange: ["组合级建议不设置单一证券价格区间"],
    stopLoss: `组合回撤达到 ${percent(maxDrawdown)}，或核心投资逻辑与资金用途发生变化`,
    takeProfit: "达到目标收益、单一持仓明显超出风险预算或组合需要再平衡",
    horizon,
    expiresAt: validUntil.toISOString(),
    reasons,
    counterEvidence: input.candidate.counterEvidence.length ? input.candidate.counterEvidence : ["市场环境可能改变当前组合判断"],
    risks: input.candidate.risks.slice(0, 3),
    alternatives: ["降低单一持仓集中度", "提高现金或低波动资产比例", "维持现有仓位并继续观察"],
    invalidation: input.candidate.invalidationConditions.join("；"),
    compliance: {
      status: input.status === "ACTIVE" ? "PASSED" : input.status,
      reasons: [input.candidate.compliance.reason, ...(input.status === "DEGRADED" ? [`数据状态：${input.research.dataState}`] : [])],
      disclaimer: "本结果仅用于投资研究和方案模拟，不连接券商，不创建真实订单。",
    },
    dataAsOf: input.research.asOfDate ?? String(input.snapshot?.as_of ?? isoNow()),
    provenance: {
      engine: "professional-chief-advisor-v2",
      scope: "PORTFOLIO",
      publicationStatus: input.status,
      dataState: input.research.dataState,
      snapshotId: input.snapshot?.id ?? null,
      investedRatio: investedRatio.toString(),
      largestHoldingWeight: largestWeight.toString(),
      holdingCount: input.holdings.length,
      modelCannotOverridePublicationGate: true,
      assumptions: input.assumptions ?? [],
    },
  };
}

function persistFindings(db: ReturnType<typeof getDatabase>, userId: string, rootRunId: string, findings: AgentFinding[], executions: PandaSourceExecution[]): void {
  const marketExecutions = executions;
  const marketDataAsOf = executions
    .map((execution) => execution.result.asOfDate)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  const portfolioSnapshot = db.prepare("SELECT as_of FROM portfolio_snapshots WHERE user_id=? ORDER BY as_of DESC,created_at DESC LIMIT 1")
    .get(userId) as { as_of?: string } | undefined;
  const riskAssessment = db.prepare("SELECT created_at FROM risk_assessments WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 1")
    .get(userId) as { created_at?: string } | undefined;
  for (const finding of findings) {
    const child = db.prepare("SELECT id FROM agent_runs WHERE root_run_id=? AND agent_type=? ORDER BY created_at DESC LIMIT 1").get(rootRunId, finding.agent.toLowerCase()) as { id?: string } | undefined;
    for (const [stance, statements] of [["support", finding.supportEvidence], ["counter", finding.counterEvidence], ["missing", finding.missingInformation]] as const) {
      for (const statement of statements) {
        const evidenceId = createId("evidence");
        const now = isoNow();
        const observedAt = observedAtForFinding({
          agent: finding.agent,
          stance,
          generatedAt: now,
          marketDataAsOf,
          portfolioSnapshotAsOf: portfolioSnapshot?.as_of ?? null,
          profileAsOf: riskAssessment?.created_at ?? null,
        });
        db.prepare(`INSERT INTO evidence_items
          (id,user_id,recommendation_id,agent_run_id,kind,stance,quality,title,summary,statement,source,observed_at,is_material,created_at)
          VALUES (?,?,NULL,?,?,?,?,?,?,?,?,?,1,?)`).run(
          evidenceId, userId, child?.id ?? rootRunId, stance === "missing" ? "missing_data" : finding.agent === "DATA_RESEARCH" ? "market_fact" : "model_inference",
          stance, finding.confidence >= 0.75 ? "high" : finding.confidence >= 0.4 ? "medium" : "low", finding.agent, statement, statement,
          finding.agent === "DATA_RESEARCH" ? "PANDADATA" : "DERIVED_ENGINE", observedAt, now,
        );
        const sources = finding.agent === "DATA_RESEARCH"
          ? marketExecutions.length ? marketExecutions : [null]
          : [null];
        for (const execution of sources) {
          db.prepare(`INSERT INTO evidence_source_links
            (id,evidence_id,data_source_id,tool_call_id,market_snapshot_id,source_locator,excerpt,created_at)
            VALUES (?,?,?,?,?,?,?,?)`).run(
            createId("evidence_link"), evidenceId,
            finding.agent === "DATA_RESEARCH" ? "source-pandadata-api" : "source-derived-engine",
            execution?.toolCallId ?? null,
            execution?.marketSnapshotIds.at(-1) ?? null,
            finding.agent === "DATA_RESEARCH" ? execution?.source.method ?? "pandadata-unavailable" : `agent:${finding.agent}`,
            statement.slice(0, 500), now,
          );
        }
        persistSseEvent({ analysisId: rootRunId, type: "evidence.added", payload: { evidenceId, stance, agent: finding.agent } });
      }
    }
  }
}

function persistConflict(db: ReturnType<typeof getDatabase>, rootRunId: string, preserved: AdvisorDecision, model: AdvisorDecision): void {
  db.prepare(`INSERT INTO agent_conflicts
    (id,root_run_id,conflict_type,summary,resolution_status,created_at)
    VALUES (?,?,? ,?,'unresolved',?)`).run(
    createId("conflict"), rootRunId, "DIRECTION_OR_ACTION_CONFLICT",
    `模型候选 ${model.requestedDirection}/${model.action} 与服务端方向 ${preserved.requestedDirection}/${preserved.action} 冲突`, isoNow(),
  );
}

export function criticalMissingInformation(
  intent: AdvisorIntent,
  profile: Profile | undefined,
  target: Instrument | null,
  holding: Holding | null,
  hasHoldings = true,
  allowProfileAssumptions = false,
): string[] {
  if (intent === "FACTOR_RESEARCH" || intent === "STRATEGY_BACKTEST") return target ? [] : ["instrument"];
  if (intent !== "BUY" && intent !== "SELL" && intent !== "DIAGNOSIS") return [];
  const profileMissing = profileMissingInformation(profile);
  const requiredProfileMissing = allowProfileAssumptions ? [] : profileMissing;
  if (intent === "DIAGNOSIS") return [...requiredProfileMissing, ...(!hasHoldings ? ["holdings"] : [])];
  return [
    ...requiredProfileMissing,
    !target ? "instrument" : null,
    intent === "SELL" && !holding ? "target_holding" : null,
  ].filter((value): value is string => Boolean(value));
}

function rolesFor(intent: AdvisorIntent, hasTarget: boolean, hasHoldings: boolean, content: string): ProfessionalAgentRole[] {
  if (requestsFullAgentLoop(content)) {
    return ["PROFILE_CONTEXT", "DATA_RESEARCH", "PORTFOLIO_RISK", "RECOMMENDATION", "COMPLIANCE_REVIEWER", "EXPLANATION_REPORT"];
  }
  if (intent === "BUY" || intent === "SELL") return ["PROFILE_CONTEXT", "DATA_RESEARCH", "PORTFOLIO_RISK", "RECOMMENDATION", "COMPLIANCE_REVIEWER", "EXPLANATION_REPORT"];
  if (intent === "FACTOR_RESEARCH" || intent === "STRATEGY_BACKTEST") return ["PROFILE_CONTEXT", "DATA_RESEARCH", "PORTFOLIO_RISK", "COMPLIANCE_REVIEWER", "EXPLANATION_REPORT"];
  if (intent === "DIAGNOSIS") {
    const roles: ProfessionalAgentRole[] = ["PROFILE_CONTEXT", "PORTFOLIO_RISK", "COMPLIANCE_REVIEWER", "EXPLANATION_REPORT"];
    return hasTarget || hasHoldings ? ["PROFILE_CONTEXT", "DATA_RESEARCH", ...roles.slice(1)] : roles;
  }
  return hasTarget || hasHoldings
    ? ["PROFILE_CONTEXT", "DATA_RESEARCH", "PORTFOLIO_RISK", "COMPLIANCE_REVIEWER", "EXPLANATION_REPORT"]
    : ["PROFILE_CONTEXT", "PORTFOLIO_RISK", "COMPLIANCE_REVIEWER", "EXPLANATION_REPORT"];
}

function requestsFullAgentLoop(content: string): boolean {
  return /(?:所有|全部|完整|全量).*(?:agent|Agent|智能体|子智能体)|(?:agent|Agent|智能体|子智能体).*(?:所有|全部|完整|全量)|真实\s*Agent\s*回路/u.test(content);
}

function inferIntent(content: string, conversationMessages: string[] = []): AdvisorIntent {
  if (/因子|factor|ICIR|Rank\s*IC|横截面/u.test(content)) return "FACTOR_RESEARCH";
  if (/回测|backtest|策略收益|策略验证|交易规则/u.test(content)) return "STRATEGY_BACKTEST";
  if (/卖出|减仓|止盈|止损|退出|清仓/u.test(content)) return "SELL";
  if (isDiagnosisRequest(content)) return "DIAGNOSIS";
  if (isInstrumentScreeningRequest(content) || continuesInstrumentScreening(content, conversationMessages)) return "SCREENING";
  if (/买入|入场|加仓|追高|试仓|增配/u.test(content)) return "BUY";
  if (isFinancialPlanningRequest(content)) return "PLANNING";
  return "GENERAL";
}

function isInstrumentScreeningRequest(content: string): boolean {
  const instrumentWords = "(?:标的|股票|个股|[\\p{Script=Han}]{2,8}股|基金|ETF)";
  const candidateRequest = new RegExp(`(?:帮我|给我|直接|请|能否|可以).*(?:找|筛选|挑|选|推荐).*${instrumentWords}|(?:找|筛选|挑|选|推荐).*(?:几个|一些|适合).*${instrumentWords}`, "u");
  const entryRequest = new RegExp(`${instrumentWords}.*(?:适合|可以|值得).*(?:建仓|买入|布局|研究)|(?:建仓|布局).*${instrumentWords}`, "u");
  return candidateRequest.test(content) || entryRequest.test(content);
}

function continuesInstrumentScreening(content: string, conversationMessages: string[]): boolean {
  const isScreeningFollowUp = (message: string) =>
    /^(?:直接开始分析|开始分析|继续|长线(?:投资)?|中线(?:投资)?|短线(?:投资)?|稳健些|激进些|保守些|个股|ETF|基金|都可以)[！!。.\s]*$/u.test(message.trim());
  if (!isScreeningFollowUp(content)) return false;
  for (const message of [...conversationMessages].reverse().slice(0, 6)) {
    if (isInstrumentScreeningRequest(message)) return true;
    if (!isScreeningFollowUp(message)) return false;
  }
  return false;
}

function isDiagnosisRequest(content: string): boolean {
  if (/诊断|持仓分析|集中度|组合健康/u.test(content)) return true;
  return /(?:分析|评估|看看|检查).*(?:风险|回撤|浮盈)|(?:风险|回撤|浮盈).*(?:怎么样|如何|多少|分析|评估)/u.test(content);
}

function isFinancialPlanningRequest(content: string): boolean {
  const financeTopic = /理财|投资|资产|资金|存款|现金流|应急金|方案|规划|配置|基金|ETF|债券/u;
  const asksForHelp = /帮我|请|怎么|如何|应该|怎么办|能不能|可以吗|是否|给我|整理|制定|安排|做一份|适合我|有什么区别|为什么/u;
  return financeTopic.test(content) && asksForHelp.test(content);
}

function directionForIntent(intent: AdvisorIntent): AdvisorDecision["requestedDirection"] {
  if (intent === "BUY") return "BUY";
  if (intent === "SELL") return "SELL";
  if (intent === "DIAGNOSIS" || intent === "FACTOR_RESEARCH" || intent === "STRATEGY_BACKTEST" || intent === "SCREENING") return "ANALYZE";
  return "HOLD";
}

function isResearchStudy(intent: AdvisorIntent): boolean {
  return intent === "FACTOR_RESEARCH" || intent === "STRATEGY_BACKTEST";
}

function actionMatchesDirection(action: AdvisorDecision["action"], direction: AdvisorDecision["requestedDirection"]): boolean {
  if (direction === "BUY") return ["WATCH", "TRIAL_BUY", "SCALE_IN", "STOP_ADDING"].includes(action);
  if (direction === "SELL") return ["HOLD", "STOP_ADDING", "SCALE_OUT", "EXIT"].includes(action);
  return ["WATCH", "HOLD", "STOP_ADDING"].includes(action);
}

export function chiefPrompt(
  question: string,
  profile: Profile | undefined,
  goals: Goal[],
  holdings: Holding[],
  snapshot: Record<string, unknown> | undefined,
  target: Instrument | null,
  research: ResearchState,
  findings: AgentFinding[],
  requiredRoles: ProfessionalAgentRole[],
  semanticContext: AdvisorSemanticToolsContext,
  dailyPortfolio = false,
): string {
  const cash = decimal(snapshot?.cash_decimal);
  const totalMarketValue = decimal(snapshot?.total_market_value_decimal);
  const completeness = profileCompletenessFor(profile, dailyPortfolio);
  const marketFacts = research.executions.map(({ source, result }) => ({
    method: source.method,
    requestedSymbol: source.parameters.symbol,
    rowCount: result.data.length,
    asOfDate: result.asOfDate,
      rows: [...result.data].sort(compareMarketRows).slice(-5),
  }));
  return [
    `用户问题：${question}`,
    dailyPortfolio
      ? "工作模式：DAILY_PORTFOLIO。缺失画像字段只能使用保守默认假设，不得阻塞任务，也不得写回用户画像。"
      : "工作模式：CONVERSATION。缺失关键画像信息时可以要求用户补充。",
    `服务端当前时间：${isoNow()}；数据状态由服务端计算，禁止自行改写或臆测数据已过期`,
    `必须委派：${requiredRoles.join(", ")}`,
    `用户画像：${json(profile ?? {})}`,
    `用户画像完整性：${json(completeness)}。complete=true 时这些画像字段已知，禁止重复要求用户补齐画像；应直接基于画像回答当前问题。`,
    "普通模式路由要求：只有画像不完整且问题仍是开放式 GENERAL 时才继续澄清；画像完整后必须由 Chief Advisor 作为真正理财顾问回答。无标的的一般理财/资产配置/资金规划问题不得要求补充 instrument。",
    `用户目标：${json(goals)}`,
    `现金与组合快照：${json({
      snapshotId: snapshot?.id ?? null,
      asOf: snapshot?.as_of ?? null,
      cash: cash?.toString() ?? null,
      totalMarketValue: totalMarketValue?.toString() ?? null,
      totalAssets: cash && totalMarketValue ? cash.plus(totalMarketValue).toString() : null,
      dataQuality: snapshot?.data_quality ?? null,
    })}`,
    `持仓摘要：${json(holdings.map((holding) => ({
      symbol: holding.symbol,
      name: holding.name,
      market: holding.market,
      quantity: holding.quantity_decimal,
      cost: holding.cost_decimal,
      price: holding.price_decimal,
      marketValue: holding.market_value_decimal,
      unrealizedPnl: holding.unrealized_pnl_decimal,
      weightBps: holding.weight_bps,
    })))}`,
    `目标标的：${json(target)}`,
    `数据状态：${research.dataState}，数据日期：${research.asOfDate ?? "未知"}`,
    "状态说明：LATEST_TRADING_DAY 表示行情日期已由 PandaData 官方交易日历确认，是当前非交易时段可获得的最近正式收盘数据，不得称为 STALE；执行时需复核下一交易时段价格。",
    `实时/行情数据摘要：${json(research.quotes)}`,
    `服务端历史风险指标：${json({ riskMetrics: research.riskMetrics, correlations: research.correlations })}`,
    `基本面与消息面检索结果：${json(research.fundamentalSearch ?? { status: "NOT_RUN" })}`,
    `因子/策略研究结果（仅服务端确定性计算）：${json(research.study ?? null)}`,
    `真实行情明细（来自 PandaData，不是行数）：${json(marketFacts)}`,
    `语义层工具上下文：${json(summarizeAdvisorSemanticToolsContext(semanticContext))}`,
    `确定性节点发现：${json(findings)}`,
    "请动态委派并输出结构化候选；服务端会独立执行发布门和方向保护。请直接回答用户当前追问，不要固定回复“下一步先整理资金分层”。",
  ].join("\n");
}

export function formatAdvisorDecisionAnswer(
  decision: AdvisorDecision,
  status: PublicationStatus,
  findings: AgentFinding[],
  researchState: ResearchState,
  publicationReasons: string[],
  profile: Profile | undefined,
  goals: Goal[],
): string {
  const profileFinding = findings.find((finding) => finding.agent === "PROFILE_CONTEXT");
  const risk = findings.find((finding) => finding.agent === "PORTFOLIO_RISK");
  const compliance = findings.find((finding) => finding.agent === "COMPLIANCE_REVIEWER");
  const profileEvidence = [
    profileFinding?.conclusion,
    ...formatProfileFacts(profile),
    ...goals.slice(0, 2).map((goal) => `投资目标：${goal.name}，期限：${translateHorizon(goal.horizon)}${goal.target_amount_decimal ? `，目标金额：${goal.target_amount_decimal} 元` : ""}`),
    ...(profileFinding?.supportEvidence ?? []).map((evidence) => translateProfileValue(evidence)),
  ].filter(Boolean);
  const marketEvidence = formatMarketEvidence(researchState);
  const fundamentalEvidence = formatFundamentalEvidence(researchState.fundamentalSearch, decision.fundamentalSummary);
  const supportEvidence = uniqueEvidence([
    ...decision.rationales,
    ...(profileFinding?.supportEvidence ?? []),
    ...marketEvidence,
    risk?.conclusion ?? "",
  ]).slice(0, 5);
  const counterEvidence = buildCounterEvidence(decision, findings, researchState);
  return [
    `建议状态：${advisorStatusLabel(status)}；建议动作：${advisorActionLabel(decision.action, status)}`,
    `核心结论：${translateReportText(decision.summary)}`,
    `用户画像与投资目标依据：${profileEvidence.join("；") || "本次未获得可用的用户画像和投资目标证据"}`,
    `行情与技术观察：${marketEvidence.join("；") || "本次未获得可用的行情或技术面证据"}`,
    `基本面与消息面依据：${fundamentalEvidence}`,
    `组合影响：${decision.portfolioImpact}`,
    `风险复核：${risk?.conclusion ?? "尚未形成组合风险结论"}`,
    `多方证据：${supportEvidence.join("；") || "本次未形成明确的多方证据"}`,
    `空方证据：${counterEvidence.join("；") || "本次未形成明确的空方证据"}`,
    `合规结论：${compliance?.conclusion ?? decision.compliance.reason}`,
    ...(status !== "ACTIVE" ? [`执行边界：${userFacingPublicationBoundary(status, decision, publicationReasons)}`] : []),
    "建议卡已保存，可在证据包中复核数据来源、空方证据和失效条件。",
    "仅支持模拟采纳，不连接券商，不创建真实订单。",
  ].join("\n");
}

function advisorStatusLabel(status: PublicationStatus): string {
  if (status === "ACTIVE") return "条件已满足，可进入模拟决策";
  if (status === "BLOCKED") return "暂不执行";
  return "谨慎参考";
}

function advisorActionLabel(action: AdvisorDecision["action"], status: PublicationStatus): string {
  if (status === "BLOCKED") {
    if (action === "STOP_ADDING") return "停止加仓";
    if (action === "SCALE_IN" || action === "TRIAL_BUY") return "暂缓加仓";
    if (action === "SCALE_OUT" || action === "EXIT") return "暂缓交易，先核验风险条件";
    return "保持现状，先完成风险核验";
  }
  const labels: Record<AdvisorDecision["action"], string> = {
    WATCH: "继续观察",
    TRIAL_BUY: "小额试仓",
    SCALE_IN: "分批加仓",
    HOLD: "继续持有",
    STOP_ADDING: "停止加仓",
    SCALE_OUT: "分批减仓",
    EXIT: "退出持仓",
  };
  return labels[action];
}

function publishedAction(
  action: AdvisorDecision["action"],
  status: PublicationStatus,
  hasTargetHolding: boolean,
): AdvisorDecision["action"] {
  if (status !== "BLOCKED") return action;
  if (action === "SCALE_IN" || action === "TRIAL_BUY") return hasTargetHolding ? "STOP_ADDING" : "WATCH";
  if (action === "SCALE_OUT" || action === "EXIT") return "HOLD";
  return action;
}

function userFacingPublicationBoundary(
  status: PublicationStatus,
  decision: AdvisorDecision,
  publicationReasons: string[],
): string {
  const modelReason = sanitizeInternalAdvisorDiagnostics(decision.compliance.reason);
  if (modelReason) return modelReason;
  const publicReason = publicationReasons.map(sanitizeInternalAdvisorDiagnostics).find(Boolean);
  if (publicReason) return publicReason;
  return status === "BLOCKED"
    ? "当前仍有关键风险或证据缺口，先不要执行交易。"
    : "当前结论可以用于研究，但执行前仍需核验最新行情和组合约束。";
}

function sanitizeInternalAdvisorDiagnostics(value: string): string {
  if (/(?:schema|coercion|rationales|counterEvidence|debateSuggestion|Chief Advisor|结构化输出)/iu.test(value)) return "";
  return value
    .replaceAll(/\b(?:APPROVED|DOWNGRADED|BLOCKED|ACTIVE|DEGRADED)\b/gu, "")
    .replaceAll(/\s{2,}/gu, " ")
    .trim();
}

function uniqueEvidence(items: string[]): string[] {
  return [...new Set(items.map((item) => sanitizeResearchText(translateReportText(item), 700)).filter(Boolean))];
}

function buildCounterEvidence(
  decision: AdvisorDecision,
  findings: AgentFinding[],
  research: ResearchState,
): string[] {
  const specificCautions = [
    research.riskMetrics.length
      ? "历史波动和最大回撤只代表过去样本，未来可能出现更大幅度波动。"
      : "",
    research.fundamentalSearch?.results.length
      ? "公开资料可能存在发布时间滞后或统计口径差异，不能只凭单条新闻判断长期价值。"
      : "基本面和消息面资料不完整，暂时不能确认长期盈利和估值是否匹配。",
    research.dataState === "LATEST_TRADING_DAY"
      ? "当前使用最近交易日收盘数据，下一交易时段价格可能出现明显变化。"
      : "",
  ];
  const candidates = [
    ...specificCautions,
    ...decision.counterEvidence,
    ...findings.flatMap((finding) => finding.counterEvidence),
  ];
  const usable = uniqueEvidence(candidates).filter((item) => !/模型输出不完整|MODEL_OUTPUT_EMPTY|Chief Advisor/iu.test(item));
  return usable.slice(0, 5).length
    ? usable.slice(0, 5)
    : ["当前公开资料或行情证据仍不完整，结论需要在新数据出现后重新复核。"];
}

function formatMarketPrice(value: string | null): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "暂无";
}

function formatRatioAsPercent(value: string | null): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(2)}%` : "暂无法计算";
}

function formatMarketDate(value: string | null): string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : value ?? "未知日期";
}

function translateSearchAdapter(adapter: string): string {
  return {
    WEB: "公开网页",
    MCP: "研究搜索服务",
    RSS: "资讯订阅",
    KNOWLEDGE_BASE: "内部知识库",
  }[adapter.toUpperCase()] ?? "外部研究来源";
}

function translateReportText(value: string): string {
  return value
    .replaceAll("Agent", "智能顾问")
    .replaceAll("PandaData", "行情数据服务")
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
    .replaceAll("HHI", "集中度指标")
    .replaceAll("R1", "保守型")
    .replaceAll("R2", "谨慎型")
    .replaceAll("R3", "稳健型")
    .replaceAll("R4", "成长型")
    .replaceAll("R5", "进取型")
    .replaceAll("BALANCED", "平衡型")
    .replaceAll("BROAD_INDEX_ETF", "宽基指数或 ETF")
    .replaceAll("INDEX", "指数基金")
    .replaceAll("SECTOR_ETF", "行业 ETF")
    .replaceAll("STOCK", "个股")
    .replaceAll("SHORT", "短线")
    .replaceAll("MEDIUM", "中线")
    .replaceAll("LONG", "长线");
}

function formatMarketEvidence(research: ResearchState): string[] {
  const names = new Map(research.quotes.map((quote) => [normalizeSymbol(quote.symbol), quote.name]));
  const quoteEvidence = research.quotes
    .filter((quote) => quote.latest)
    .map((quote) => `${quote.name}（${quote.symbol}）最近交易日收盘价约为 ${formatMarketPrice(quote.latest)} 元，数据截至 ${formatMarketDate(quote.asOfDate)}`);
  const riskEvidence = research.riskMetrics.map((metric) => {
    const name = names.get(normalizeSymbol(metric.symbol)) ?? metric.symbol;
    const volatility = formatRatioAsPercent(metric.annualizedVolatility);
    const drawdown = formatRatioAsPercent(metric.maxDrawdown);
    return `${name}近 ${metric.observations} 个交易日的历史年化波动约为 ${volatility}，历史最大回撤约为 ${drawdown}`;
  });
  const scope = research.riskMetrics.length
    ? "本次观察使用了收盘价、历史波动和最大回撤，不包含完整的均线、估值或成交量形态判断。"
    : "";
  return [...quoteEvidence, ...riskEvidence, scope].filter(Boolean);
}

function formatFundamentalEvidence(search: ResearchState["fundamentalSearch"], summary?: string): string {
  if (!search) return "本次资产报告流程未执行基本面和消息面检索，因此没有可用的此类证据；本报告未据此判断。";
  if (!search.results.length) {
    const failed = search.sourceStatuses
      .filter((source) => source.status === "FAILED")
      .map((source) => translateSearchAdapter(source.adapter));
    return failed.length
      ? `已执行基本面和消息面检索，但 ${failed.join("、")} 来源暂不可用，当前未返回可用结果；本报告未据此判断。`
      : "已执行基本面和消息面检索，但当前未返回可用结果；本报告未据此判断。";
  }
  const cleanSummary = summary ? sanitizeResearchText(summary, 700) : "";
  if (cleanSummary) {
    return `顾问总结：${cleanSummary}（依据 ${search.results.length} 条公开信息）`;
  }
  const failed = search.sourceStatuses
    .filter((source) => source.status === "FAILED")
    .map((source) => translateSearchAdapter(source.adapter));
  return [
    `已执行基本面和消息面检索，返回 ${search.results.length} 条公开信息，但顾问总结暂未形成；原始资料已保存在证据包中，本报告不把搜索片段直接当作结论。`,
    failed.length ? `其中 ${failed.join("、")} 来源暂不可用，已使用其他可用来源继续分析。` : "",
  ].filter(Boolean).join(" ");
}

async function searchFundamentalAndNews(
  input: { userId: string; analysisId: string; rootAnalysisId?: string },
  target: Instrument | null,
  holdings: Holding[],
): Promise<NonNullable<ResearchState["fundamentalSearch"]>> {
  type SearchRun = Awaited<ReturnType<typeof runResearchSearch>>;
  const instruments = (target ? [target] : holdings).slice(0, 8);
  const queries = instruments.map((instrument) => ({
    instrument,
    query: `${instrument.name} ${instrument.symbol} 基本面 财务 业绩 公告 新闻 估值 行业`,
  }));
  const results: SearchRun[] = await Promise.all(queries.map(async ({ query }): Promise<SearchRun> => {
    try {
      return await runResearchSearch({
        userId: input.userId,
        query,
        adapters: ["WEB", "MCP", "RSS"],
        maximumResults: 5,
        timeoutMs: 4_000,
        rootRunId: input.rootAnalysisId ?? input.analysisId,
      });
    } catch (error) {
      return {
        searchId: "",
        analysisId: "",
        resultCount: 0,
        status: "FAILED" as const,
        results: [],
        sourceStatuses: (["WEB", "MCP", "RSS"] as const).map((adapter) => ({
          adapter,
          status: "FAILED",
          resultCount: 0,
          error: {
            code: `${adapter}_UNAVAILABLE`,
            message: error instanceof Error ? error.message : "Search source failed",
            retryable: true,
          },
        })),
      };
    }
  }));
  const searchIds = results.map((result) => result.searchId).filter(Boolean);
  const query = queries.map(({ query: item }) => item).join("；");
  const seen = new Set<string>();
  const mergedResults = results.flatMap((result) => result.results).filter((result) => {
    const key = `${result.url}|${result.title}|${result.snippet}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 24);
  const sourceStatuses: NonNullable<ResearchState["fundamentalSearch"]>["sourceStatuses"] = (["WEB", "MCP", "RSS"] as const).map((adapter) => {
    const groups = results.flatMap((result) => result.sourceStatuses).filter((source) => source.adapter === adapter);
    const resultCount = groups.reduce((total, source) => total + source.resultCount, 0);
    const failed = groups.find((source) => source.status === "FAILED" && source.error);
    return {
      adapter,
      status: resultCount > 0 ? "SUCCEEDED" : failed ? "FAILED" : "SUCCEEDED",
      resultCount,
      error: failed?.error ?? null,
    };
  });
  const result = {
    searchId: searchIds[0] ?? "",
    searchIds,
    results: mergedResults,
    sourceStatuses,
  };
  persistSseEvent({
    analysisId: input.analysisId,
    type: "advisor.thinking",
    payload: {
      phase: "fundamental_news_research",
      title: "正在检索基本面与消息面",
      content: result.results.length ? `已返回 ${result.results.length} 条公开信息线索` : "检索完成，但当前没有可用公开信息",
      searchId: result.searchId || null,
      searchIds: result.searchIds,
    },
  });
  return {
    query,
    searchId: result.searchId,
    searchIds: result.searchIds,
    results: result.results,
    sourceStatuses: result.sourceStatuses,
  };
}

function formatProfileFacts(profile: Profile | undefined): string[] {
  if (!profile) return [];
  const preferences = parsePreferences(profile.preferences_json);
  return [
    profile.risk_level ? `风险承受类型：${translateProfileValue(profile.risk_level)}` : "",
    profile.investment_amount_decimal ? `可投资金额：${profile.investment_amount_decimal} 元` : "",
    profile.horizon ? `计划期限：${translateHorizon(profile.horizon)}` : "",
    profile.max_drawdown_decimal ? `可接受最大回撤：${profile.max_drawdown_decimal}` : "",
    preferences.instrumentPreference ? `偏好资产：${translateProfileValue(String(preferences.instrumentPreference))}` : "",
    preferences.nearTermUse !== undefined ? `近期用款：${preferences.nearTermUse ? "有明确安排" : "暂无明确安排"}` : "",
  ].filter(Boolean);
}

function translateHorizon(value: string): string {
  if (value === "SHORT") return "短线（1 年以内）";
  if (value === "LONG") return "长线（3 年以上）";
  return value === "MEDIUM" ? "中线（1-3 年）" : value;
}

function translateProfileValue(value: string): string {
  return value
    .replaceAll("R1", "保守型")
    .replaceAll("R2", "谨慎型")
    .replaceAll("R3", "稳健型")
    .replaceAll("R4", "成长型")
    .replaceAll("R5", "进取型")
    .replaceAll("BALANCED", "平衡型")
    .replaceAll("CONSERVATIVE", "保守型")
    .replaceAll("AGGRESSIVE", "进取型")
    .replaceAll("BROAD_INDEX_ETF", "宽基指数或 ETF")
    .replaceAll("INDEX", "指数基金")
    .replaceAll("SECTOR_ETF", "行业 ETF")
    .replaceAll("STOCK", "个股")
    .replaceAll("instrumentPreference", "偏好资产")
    .replaceAll("risk_level", "风险等级")
    .replaceAll("investment_amount", "可投资金额")
    .replaceAll("max_drawdown", "最大回撤")
    .replaceAll("SHORT", "短线")
    .replaceAll("MEDIUM", "中线")
    .replaceAll("LONG", "长线");
}

function annualizedVolatility(closes: Decimal[]): Decimal | null {
  if (closes.length < 3) return null;
  const returns = closes.slice(1).flatMap((price, index) => closes[index].gt(0) ? [price.div(closes[index]).minus(1)] : []);
  if (returns.length < 2) return null;
  const mean = Decimal.sum(...returns).div(returns.length);
  const variance = Decimal.sum(...returns.map((value) => value.minus(mean).pow(2))).div(returns.length - 1);
  return variance.sqrt().mul(new Decimal(252).sqrt());
}

function percent(value: Decimal): string {
  return `${value.mul(100).toDecimalPlaces(2).toString()}%`;
}

function decimal(value: unknown): Decimal | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  try {
    const result = new Decimal(String(value));
    return result.isFinite() ? result : null;
  } catch {
    return null;
  }
}

function maximumDrawdown(closes: Decimal[]): Decimal | null {
  if (closes.length < 2) return null;
  let peak = closes[0];
  let drawdown = new Decimal(0);
  for (const close of closes.slice(1)) {
    if (close.gt(peak)) peak = close;
    if (peak.gt(0)) drawdown = Decimal.max(drawdown, peak.minus(close).div(peak));
  }
  return drawdown;
}

function marketSeries(execution: PandaSourceExecution) {
  const symbol = String(execution.source.parameters.symbol instanceof Array
    ? execution.source.parameters.symbol[0]
    : execution.source.parameters.symbol ?? execution.source.dataset);
  const points = [...execution.result.data]
    .sort(compareMarketRows)
    .flatMap((row) => {
      const close = decimal(row.close);
      const date = marketRowDate(row);
      return close && date ? [{ date, close }] : [];
    });
  return { symbol, points };
}

function pairwiseCorrelations(series: ReturnType<typeof marketSeries>[]): ResearchState["correlations"] {
  const correlations: ResearchState["correlations"] = [];
  for (let leftIndex = 0; leftIndex < series.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < series.length; rightIndex += 1) {
      const leftReturns = returnSeries(series[leftIndex].points);
      const rightReturns = returnSeries(series[rightIndex].points);
      const dates = [...leftReturns.keys()].filter((date) => rightReturns.has(date));
      const pairs = dates.map((date) => [leftReturns.get(date)!, rightReturns.get(date)!] as const);
      correlations.push({
        left: series[leftIndex].symbol,
        right: series[rightIndex].symbol,
        observations: pairs.length,
        value: pearsonCorrelation(pairs)?.toDecimalPlaces(6).toString() ?? null,
      });
    }
  }
  return correlations;
}

function returnSeries(points: Array<{ date: string; close: Decimal }>): Map<string, Decimal> {
  const returns = new Map<string, Decimal>();
  for (let index = 1; index < points.length; index += 1) {
    if (points[index - 1].close.gt(0)) returns.set(points[index].date, points[index].close.div(points[index - 1].close).minus(1));
  }
  return returns;
}

function pearsonCorrelation(pairs: ReadonlyArray<readonly [Decimal, Decimal]>): Decimal | null {
  if (pairs.length < 3) return null;
  const leftMean = Decimal.sum(...pairs.map(([left]) => left)).div(pairs.length);
  const rightMean = Decimal.sum(...pairs.map(([, right]) => right)).div(pairs.length);
  const numerator = Decimal.sum(...pairs.map(([left, right]) => left.minus(leftMean).mul(right.minus(rightMean))));
  const leftScale = Decimal.sum(...pairs.map(([left]) => left.minus(leftMean).pow(2))).sqrt();
  const rightScale = Decimal.sum(...pairs.map(([, right]) => right.minus(rightMean).pow(2))).sqrt();
  if (leftScale.eq(0) || rightScale.eq(0)) return null;
  return numerator.div(leftScale.mul(rightScale));
}

function compareMarketRows(left: Record<string, unknown>, right: Record<string, unknown>): number {
  return marketRowDate(left).localeCompare(marketRowDate(right));
}

function marketRowDate(row: Record<string, unknown>): string {
  const value = row.date ?? row.trade_date ?? row.datetime ?? row.timestamp;
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function resolveTargetInstrument(input: {
  content: string;
  targetSymbol?: string | null;
  instruments: Instrument[];
  holdings?: Holding[];
}): Instrument | null {
  const heldInstruments = (input.holdings ?? []).map((holding) =>
    input.instruments.find((instrument) => instrument.id === holding.instrument_id) ?? {
      id: holding.instrument_id,
      symbol: holding.symbol,
      name: holding.name,
      asset_type: holding.asset_type,
      market: marketForHolding(holding),
    }
  );
  const allInstruments = uniqueInstruments([...heldInstruments, ...input.instruments]);
  const trustedSymbol = input.targetSymbol?.trim();
  if (trustedSymbol) return findInstrumentBySymbol(allInstruments, trustedSymbol);

  const symbolCandidates = extractSymbolCandidates(input.content);
  const explicitCandidates = symbolCandidates.filter((candidate) =>
    !/^\d{6}$/u.test(candidate.symbol) || isExplicitBareNumericSymbol(input.content, candidate)
  );
  const symbolMatches = uniqueInstruments(explicitCandidates.flatMap((candidate) => {
    const match = findInstrumentBySymbol(allInstruments, candidate.symbol);
    return match ? [match] : [];
  }));
  if (symbolMatches.length > 1) return null;
  if (symbolMatches.length === 1) return symbolMatches[0];
  if (explicitCandidates.some((candidate) =>
    /^\d/u.test(candidate.symbol) || /\.(?:SH|SZ|OF|US|HK)$/u.test(candidate.symbol)
  )) return null;

  return findInstrumentByName(input.content, allInstruments, new Set(heldInstruments.map((instrument) => instrument.id)));
}

function extractSymbolCandidates(content: string): Array<{ symbol: string; index: number }> {
  const upper = content.normalize("NFKC").toUpperCase();
  return [...upper.matchAll(/\b(?:\d{6}(?:\.(?:SH|SZ|OF))?|\d{5}\.HK|[A-Z]{1,10}(?:\.(?:US|HK))?)\b/gu)]
    .map((match) => ({ symbol: match[0], index: match.index }));
}

function isExplicitBareNumericSymbol(content: string, candidate: { symbol: string; index: number }): boolean {
  const before = content.slice(Math.max(0, candidate.index - 8), candidate.index);
  const after = content.slice(candidate.index + candidate.symbol.length, candidate.index + candidate.symbol.length + 6);
  if (/(?:投入|金额|资金|本金|预算)\s*$/u.test(before) || /^\s*(?:元|块|万元|万)/u.test(after)) return false;
  return true;
}

function uniqueInstruments(instruments: Instrument[]): Instrument[] {
  return [...new Map(instruments.map((instrument) => [instrument.id, instrument])).values()];
}

function findInstrumentBySymbol(instruments: Instrument[], symbol: string): Instrument | null {
  const requested = symbol.trim().toUpperCase();
  const exactMatches = uniqueInstruments(instruments.filter((instrument) => instrument.symbol.trim().toUpperCase() === requested));
  if (exactMatches.length) return exactMatches.length === 1 ? exactMatches[0] : null;

  const suffixMatch = requested.match(/^([A-Z]{1,10})\.(US|HK)$/u);
  if (suffixMatch) {
    const [, base, suffix] = suffixMatch;
    const matches = uniqueInstruments(instruments.filter((instrument) =>
      instrument.symbol.trim().toUpperCase() === base && marketMatchesSymbolSuffix(instrument.market, suffix)
    ));
    return matches.length === 1 ? matches[0] : null;
  }
  if (requested.includes(".")) return null;

  const matches = uniqueInstruments(instruments.filter((instrument) => symbolBase(instrument.symbol) === requested));
  return matches.length === 1 ? matches[0] : null;
}

function marketMatchesSymbolSuffix(market: string, suffix: string): boolean {
  const normalized = market.toUpperCase();
  return suffix === "US"
    ? ["US", "NASDAQ", "NYSE", "AMEX"].includes(normalized)
    : normalized === "HK";
}

function symbolBase(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\.(?:SH|SZ|OF|US|HK)$/u, "");
}

function findInstrumentByName(content: string, instruments: Instrument[], heldInstrumentIds: Set<string>): Instrument | null {
  const matches = instruments.flatMap((instrument) =>
    instrumentNameAliases(instrument.name)
      .filter(isDistinctiveInstrumentName)
      .flatMap((alias) => nameOccurrences(content, alias).map((range) => ({
        instrument,
        aliasLength: alias.length,
        held: heldInstrumentIds.has(instrument.id),
        ...range,
      })))
  );
  if (!matches.length) return null;
  const dominant = matches.filter((match) => !matches.some((candidate) =>
    candidate.aliasLength > match.aliasLength
    && rangesOverlap(match, candidate)
  ));
  const instrumentIds = new Set(dominant.map((match) => match.instrument.id));
  if (instrumentIds.size === 1) return dominant[0].instrument;
  const sameRange = dominant.every((match) =>
    match.start === dominant[0].start && match.end === dominant[0].end
  );
  const heldMatches = uniqueInstruments(dominant.filter((match) => match.held).map((match) => match.instrument));
  return sameRange && heldMatches.length === 1 ? heldMatches[0] : null;
}

function nameOccurrences(content: string, alias: string): Array<{ start: number; end: number }> {
  if (/\p{Script=Han}/u.test(alias)) {
    const normalizedContent = normalizeInstrumentName(content);
    const ranges: Array<{ start: number; end: number }> = [];
    let start = normalizedContent.indexOf(alias);
    while (start >= 0) {
      ranges.push({ start, end: start + alias.length });
      start = normalizedContent.indexOf(alias, start + 1);
    }
    return ranges;
  }
  const normalizedContent = content.normalize("NFKC").toUpperCase();
  const pattern = new RegExp(`(?<![\\p{Letter}\\p{Number}])${escapeRegex(alias)}(?![\\p{Letter}\\p{Number}])`, "gu");
  return [...normalizedContent.matchAll(pattern)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function rangesOverlap(
  left: { start: number; end: number },
  right: { start: number; end: number },
): boolean {
  return left.start < right.end && right.start < left.end;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function instrumentNameAliases(name: string): string[] {
  const normalized = normalizeInstrumentAlias(name);
  const withoutListingSuffix = normalized.replace(/-(?:U|W|WD)$/u, "");
  return [...new Set([normalized, withoutListingSuffix].filter(Boolean))];
}

function normalizeInstrumentAlias(value: string): string {
  const normalized = value.normalize("NFKC").toUpperCase().trim();
  return /\p{Script=Han}/u.test(normalized)
    ? normalized.replaceAll(/\s+/gu, "")
    : normalized.replaceAll(/\s+/gu, " ");
}

function normalizeInstrumentName(value: string): string {
  return value.normalize("NFKC").toUpperCase().replaceAll(/\s+/gu, "");
}

function isDistinctiveInstrumentName(name: string): boolean {
  if (new Set(["股票", "基金", "指数", "债券", "科技股", "银行股", "医药股"]).has(name)) return false;
  const chineseCharacters = name.match(/\p{Script=Han}/gu)?.length ?? 0;
  if (chineseCharacters >= 3) return true;
  return name.replaceAll(/[^\p{Letter}\p{Number}]/gu, "").length >= 4;
}

function normalizeSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  const bare = upper.match(/^\d{6}(?=\.(?:SH|SZ|OF)$)/u)?.[0] ?? upper;
  return bare;
}

function marketDataset(target: Instrument): PandaQuerySource["dataset"] {
  const symbol = target.symbol.toUpperCase();
  if (target.asset_type.toUpperCase().includes("FUND") || target.asset_type.toUpperCase().includes("ETF") || /^(?:15|16|50|51|56)\d{4}(?:\.(?:SH|SZ|OF))?$/u.test(symbol)) return "MARKET_FUND_DAILY";
  if (target.asset_type.toUpperCase().includes("INDEX")) return "MARKET_INDEX_DAILY";
  if (target.market.toUpperCase() === "US") return "MARKET_US_DAILY";
  if (target.market.toUpperCase() === "HK") return "MARKET_HK_DAILY";
  return "MARKET_STOCK_RT_DAILY";
}

function marketMethod(target: Instrument): PandaQuerySource["method"] {
  const dataset = marketDataset(target);
  switch (dataset) {
    case "MARKET_STOCK_RT_DAILY": return "get_stock_rt_daily";
    case "MARKET_FUND_DAILY": return "get_fund_daily";
    case "MARKET_INDEX_DAILY": return "get_index_daily";
    case "MARKET_US_DAILY": return "get_us_daily";
    case "MARKET_HK_DAILY": return "get_hk_daily";
    default: return "get_stock_daily";
  }
}

function marketForSymbol(symbol: string): string {
  const suffix = symbol.toUpperCase().split(".").at(-1);
  return suffix === "US" ? "US" : suffix === "HK" ? "HK" : suffix === "SH" || suffix === "SZ" || suffix === "OF" ? suffix : "UNKNOWN";
}

export function marketForHolding(holding: { symbol: string; market?: string | null }): string {
  const market = holding.market?.trim().toUpperCase();
  return market || marketForSymbol(holding.symbol);
}

function pandaSymbol(symbol: string, assetType: string, market: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (normalized.includes(".")) return normalized;
  if (!assetType.toUpperCase().includes("STOCK")) return normalized;
  if (market.toUpperCase() === "SH" || market.toUpperCase() === "SZ" || market.toUpperCase() === "OF") return `${normalized}.${market.toUpperCase()}`;
  if (/^6\d{5}$/u.test(normalized)) return `${normalized}.SH`;
  if (/^(?:0|2|3)\d{5}$/u.test(normalized)) return `${normalized}.SZ`;
  return normalized;
}

function normalizeHorizon(value: unknown): "SHORT" | "MEDIUM" | "LONG" {
  return value === "SHORT" || value === "LONG" ? value : "MEDIUM";
}

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/(?:token|password|secret|api[_-]?key)\s*[:=]\s*\S+/giu, "$1=[REDACTED]").slice(0, 500);
}

function parsePreferences(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function profileWithDailyAssumptions(profile: Profile | undefined): Profile {
  const preferences = parsePreferences(profile?.preferences_json);
  return {
    ...profile,
    risk_level: profile?.risk_level ?? "BALANCED",
    horizon: profile?.horizon ?? "MEDIUM",
    max_drawdown_decimal: profile?.max_drawdown_decimal ?? "0.10",
    preferences_json: json({
      ...preferences,
      instrumentPreference: preferences.instrumentPreference ?? "BROAD_INDEX_ETF",
      nearTermUse: preferences.nearTermUse ?? false,
    }),
  };
}
