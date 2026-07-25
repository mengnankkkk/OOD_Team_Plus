import Decimal from "decimal.js";

import { runChiefAdvisor, type ChiefAdvisorStreamEvent } from "@/mastra/agents/chief-advisor";
import { executePandaSources, type PandaSourceExecution } from "@/server/extensions/query/panda-query-executor";
import type { PandaQuerySource } from "@/server/extensions/query/market-catalog";
import { persistSseEvent } from "@/server/extensions/sse/event-persister";
import { createId, getDatabase, isoNow, json } from "@/server/http/context";

import {
  AgentFindingSchema,
  AdvisorDecisionSchema,
  type AgentFinding,
  type AdvisorDecision,
  type ProfessionalAgentRole,
} from "./professional-contracts";
import { loadAdvisorSemanticToolsContext, summarizeAdvisorSemanticToolsContext, type AdvisorSemanticToolsContext } from "./semantic-tools";
import type { RecommendationDraft } from "./types";

export { AgentFindingSchema, AdvisorDecisionSchema } from "./professional-contracts";
export type { AgentFinding, AdvisorDecision, ProfessionalAgentRole } from "./professional-contracts";

type AdvisorIntent = "BUY" | "SELL" | "DIAGNOSIS" | "GENERAL";
type PublicationStatus = "ACTIVE" | "DEGRADED" | "BLOCKED";
type DataState = "LIVE_FRESH" | "STALE" | "UNAVAILABLE" | "NOT_REQUIRED";

type Profile = {
  risk_level?: string | null;
  investment_amount_decimal?: string | null;
  horizon?: string | null;
  max_drawdown_decimal?: string | null;
  preferences_json?: string | null;
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

type Instrument = { id: string; symbol: string; name: string; asset_type: string; market: string };

type ResearchState = {
  dataState: DataState;
  executions: PandaSourceExecution[];
  closes: Decimal[];
  latest: Decimal | null;
  asOfDate: string | null;
  quotes: Array<{ symbol: string; latest: string | null; asOfDate: string | null; method: string }>;
  riskMetrics: Array<{ symbol: string; observations: number; annualizedVolatility: string | null; maxDrawdown: string | null }>;
  correlations: Array<{ left: string; right: string; observations: number; value: string | null }>;
};

type RoleRunResult = {
  childRunId: string;
  finding: AgentFinding;
};

export type ProfessionalAdvisorResult = {
  kind: "GUIDED_INTAKE" | "DECISION";
  runId: string;
  status: PublicationStatus;
  direction: AdvisorDecision["requestedDirection"];
  action: AdvisorDecision["action"];
  findings: AgentFinding[];
  missingInformation: string[];
  recommendation: RecommendationDraft | null;
  answer: string;
  provider: "CHIEF_ADVISOR" | "DETERMINISTIC_FALLBACK";
};

export async function runProfessionalAdvisor(input: {
  userId: string;
  sessionId: string;
  analysisId: string;
  content: string;
  targetSymbol?: string;
}): Promise<ProfessionalAdvisorResult> {
  const db = getDatabase();
  const now = isoNow();
  db.prepare(`UPDATE agent_runs SET session_id=?,root_run_id=?,agent_type='chief_advisor',objective=?,started_at=COALESCE(started_at,?)
    WHERE id=? AND user_id=?`).run(input.sessionId, input.analysisId, input.content.slice(0, 500), now, input.analysisId, input.userId);
  const profile = db.prepare("SELECT risk_level,investment_amount_decimal,horizon,max_drawdown_decimal,preferences_json FROM user_profiles WHERE user_id=?").get(input.userId) as Profile | undefined;
  const conversationMessages = db.prepare("SELECT content FROM messages WHERE session_id=? AND role='user' ORDER BY created_at ASC")
    .all(input.sessionId) as Array<{ content: string }>;
  const snapshot = db.prepare("SELECT * FROM portfolio_snapshots WHERE user_id=? ORDER BY as_of DESC,created_at DESC LIMIT 1").get(input.userId) as Record<string, unknown> | undefined;
  const holdings = snapshot ? db.prepare(`SELECT hs.instrument_id,i.symbol,i.name,i.asset_type,i.market,i.sector,
      hs.quantity_decimal,hs.cost_decimal,hs.price_decimal,hs.market_value_decimal,hs.unrealized_pnl_decimal,hs.weight_bps
    FROM holding_snapshots hs JOIN instruments i ON i.id=hs.instrument_id
    WHERE hs.portfolio_snapshot_id=? ORDER BY hs.weight_bps DESC`).all(snapshot.id) as Holding[] : [];
  const instruments = db.prepare("SELECT id,symbol,name,asset_type,market FROM instruments WHERE tradable=1 ORDER BY symbol").all() as Instrument[];
  const intent = inferIntent(input.content);
  const requestedDirection = directionForIntent(intent);
  const targetSymbol = input.targetSymbol ?? extractSymbol(input.content);
  const target = targetSymbol ? findInstrumentBySymbol(instruments, targetSymbol) : null;
  const targetHolding = target ? holdings.find((holding) => holding.instrument_id === target.id) ?? null : null;
  const requiredRoles = rolesFor(intent, Boolean(target), holdings.length > 0, input.content);
  const findings: AgentFinding[] = [];
  const roleRunIds = new Map<ProfessionalAgentRole, string>();

  const registerFinding = (result: RoleRunResult): AgentFinding => {
    roleRunIds.set(result.finding.agent, result.childRunId);
    findings.push(result.finding);
    return result.finding;
  };

  try {
    if (intent === "GENERAL" && !requestsFullAgentLoop(input.content)) {
      return {
        kind: "GUIDED_INTAKE",
        runId: input.analysisId,
        status: "DEGRADED",
        direction: "HOLD",
        action: "WATCH",
        findings: [],
        missingInformation: [],
        recommendation: null,
        answer: formatGuidedIntakeAnswer(conversationMessages.map((message) => message.content)),
        provider: "DETERMINISTIC_FALLBACK",
      };
    }

    const profileFinding = registerFinding(await runRole(db, input, "PROFILE_CONTEXT", () => profileFindingFor(profile), { emitEvents: false }));

    let research: ResearchState = { dataState: target || holdings.length ? "UNAVAILABLE" : "NOT_REQUIRED", executions: [], closes: [], latest: null, asOfDate: null, quotes: [], riskMetrics: [], correlations: [] };
    if (requiredRoles.includes("DATA_RESEARCH")) {
      registerFinding(await runRole(db, input, "DATA_RESEARCH", async (childRunId) => {
        const result = await researchInstrument(db, input.analysisId, childRunId, target, holdings);
        research = result.state;
        return result.finding;
      }, { emitEvents: false }));
    }

    const riskFinding = registerFinding(await runRole(db, input, "PORTFOLIO_RISK", () => portfolioRiskFinding(holdings, snapshot, research), { emitEvents: false }));

    const deterministicDecision = deterministicDecisionFor({
      intent,
      requestedDirection,
      target,
      targetHolding,
      profileReady: profileFinding.missingInformation.length === 0,
      hasHoldings: holdings.length > 0,
      research,
      riskFinding,
    });
    if (requiredRoles.includes("RECOMMENDATION")) {
      registerFinding(await runRole(db, input, "RECOMMENDATION", () => recommendationFinding(deterministicDecision, findings), { emitEvents: false }));
    }

    const criticalMissing = criticalMissingInformation(intent, profile, target, targetHolding, holdings.length > 0);
    const complianceFinding = complianceFindingFor(criticalMissing, research.dataState, findings);
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

    let candidate = deterministicDecision;
    let provider: ProfessionalAdvisorResult["provider"] = "DETERMINISTIC_FALLBACK";
    let modelFallback = true;
    let unresolvedConflict = false;
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
          prompt: chiefPrompt(input.content, profile, holdings, target, research, findings, requiredRoles, semanticContext),
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
      marketDataRequired: requiredRoles.includes("DATA_RESEARCH") && (intent === "BUY" || intent === "SELL"),
    });
    candidate = {
      ...candidate,
      compliance: {
        approved: status === "ACTIVE",
        decision: status === "ACTIVE" ? "APPROVED" : status === "BLOCKED" ? "BLOCKED" : "DOWNGRADED",
        reason: status === "ACTIVE"
          ? "服务端数据、证据、风险和合规门均已通过"
          : status === "BLOCKED"
            ? "存在必须先补齐或确认的关键信息"
            : `建议可供研究和模拟采纳；数据状态为 ${research.dataState}`,
      },
    };
    const recommendation = target
      ? buildRecommendationDraft({
        status,
        candidate,
        target,
        holding: targetHolding,
        profile,
        research,
        snapshot,
      })
      : holdings.length > 0
        ? buildPortfolioRecommendationDraft({ status, candidate, profile, holdings, research, snapshot })
        : null;
    persistFindings(db, input.userId, input.analysisId, findings, research.executions);
    db.prepare("UPDATE agent_runs SET model_provider=?,model_name=?,output_summary=?,compliance_json=? WHERE id=?")
      .run(provider === "CHIEF_ADVISOR" ? "deepseek" : "deterministic", process.env.DEEPSEEK_MODEL ?? null,
        candidate.summary, json({ status, approved: status === "ACTIVE", simulationOnly: true }), input.analysisId);
    persistSseEvent({ analysisId: input.analysisId, type: "compliance.completed", payload: { status, dataState: research.dataState, modelFallback, unresolvedConflict } });
    const missingInformation = [...new Set([...criticalMissing, ...findings.flatMap((finding) => finding.missingInformation)])];
    return {
      kind: "DECISION",
      runId: input.analysisId,
      status,
      direction: candidate.requestedDirection,
      action: candidate.action,
      findings,
      missingInformation,
      recommendation,
      answer: formatAnswer(candidate, status, findings, research.dataState),
      provider,
    };
  } finally {
    db.close();
  }
}

async function runRole(
  db: ReturnType<typeof getDatabase>,
  input: { userId: string; sessionId: string; analysisId: string },
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
    childRunId, input.userId, input.sessionId, input.analysisId, input.analysisId, role.toLowerCase(), role, startedAt, startedAt,
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

function profileFindingFor(profile: Profile | undefined): AgentFinding {
  const preferences = parsePreferences(profile?.preferences_json);
  const missing = [
    !profile?.risk_level ? "risk_level" : null,
    !profile?.investment_amount_decimal ? "investment_amount" : null,
    !profile?.horizon ? "horizon" : null,
    !profile?.max_drawdown_decimal ? "max_drawdown" : null,
    preferences.instrumentPreference === undefined ? "instrument_preference" : null,
    preferences.nearTermUse === undefined ? "near_term_use" : null,
  ].filter((value): value is string => Boolean(value));
  return AgentFindingSchema.parse({
    agent: "PROFILE_CONTEXT",
    conclusion: missing.length ? "用户画像仍缺少影响适配性的关键信息" : "已加载风险等级、投资金额、期限和最大回撤约束",
    supportEvidence: missing.length ? [] : [`风险等级：${profile?.risk_level}`, `投资期限：${profile?.horizon}`],
    counterEvidence: [missing.length ? "缺失画像会使仓位和期限建议失真" : "画像可能随资金用途变化，需要在执行前复核"],
    missingInformation: missing,
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
      agent: "DATA_RESEARCH", conclusion: "未识别到可研究标的", supportEvidence: [], counterEvidence: ["没有明确标的时不能形成个股买卖结论"],
      missingInformation: ["instrument"], risks: ["标的歧义可能导致错误数据关联"], confidence: 0.2, needsAnotherAgent: false,
    }),
  };
  const end = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - 180);
  const sources = instruments.map((instrument): PandaQuerySource => {
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
  persistSseEvent({ analysisId: rootRunId, type: "tool.started", payload: { toolName: sources.map((source) => source.method), childRunId, symbolCount: sources.length } });
  try {
    let executions = await executePandaSources({ sources, agentRunId: childRunId, localRows: [], db });
    // PandaData's real-time endpoint legitimately returns no rows outside a
    // trading session. Use the latest official daily data as an explicit
    // stale fallback so the advisor can explain the data state instead of
    // treating an empty response as a successful quote.
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
      const fallbackExecutions = await executePandaSources({ sources: staleSources, agentRunId: childRunId, localRows: [], db });
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
    const dataState = classifyResearchDataState(executions, usedDailyFallback);
    const asOfDates = executions.map((execution) => execution.result.asOfDate).filter((value): value is string => Boolean(value)).sort();
    const quotes = executions.map((execution) => ({
      symbol: String(execution.source.parameters.symbol instanceof Array ? execution.source.parameters.symbol[0] : execution.source.parameters.symbol ?? execution.source.dataset),
      latest: [...execution.result.data].sort(compareMarketRows).map((row) => decimal(row.close)).filter((value): value is Decimal => value !== null).at(-1)?.toString() ?? null,
      asOfDate: execution.result.asOfDate,
      method: execution.source.method,
    }));
    persistSseEvent({ analysisId: rootRunId, type: "tool.completed", payload: { toolName: sources.map((source) => source.method), childRunId, rowCount: allRows.length, dataState, symbolCount: executions.length } });
    return {
      state: { dataState, executions, closes, latest, asOfDate: asOfDates.at(-1) ?? null, quotes, riskMetrics, correlations },
      finding: AgentFindingSchema.parse({
        agent: "DATA_RESEARCH",
        conclusion: `已对 ${executions.length} 个持仓/目标标的完成真实市场数据研究，状态为 ${dataState}`,
        supportEvidence: [
          latest ? `最新价格样本：${latest.toString()}` : "市场接口已完成 live call",
          `数据日期：${asOfDates.at(-1) ?? "未知"}`,
          `行情证据：${quotes.map((quote) => `${quote.symbol}=${quote.latest ?? "无价格"}@${quote.asOfDate ?? "未知"} via ${quote.method}`).join("；")}`,
        ],
        counterEvidence: [dataState === "LIVE_FRESH" ? "历史价格不能保证未来走势" : usedDailyFallback ? "实时接口当前无行情行，已使用同一数据源最近交易日数据" : "行情数据需要刷新后再确认"],
        missingInformation: latest ? [] : ["close"],
        risks: ["短期价格和成交量可能快速变化", "财务或估值字段缺失时不会推导替代值"],
        confidence: dataState === "LIVE_FRESH" && latest ? 0.82 : 0.4,
        needsAnotherAgent: true,
        suggestedNextAgent: "PORTFOLIO_RISK",
      }),
    };
  } catch (error) {
    persistSseEvent({ analysisId: rootRunId, type: "tool.failed", payload: { toolName: sources.map((source) => source.method), childRunId, code: "PANDADATA_UNAVAILABLE" } });
    return {
      state: { dataState: "UNAVAILABLE", executions: [], closes: [], latest: null, asOfDate: null, quotes: [], riskMetrics: [], correlations: [] },
      finding: AgentFindingSchema.parse({
        agent: "DATA_RESEARCH", conclusion: `${target?.symbol ?? instruments.map((instrument) => instrument.symbol).join("、")} 的 PandaData live call 不可用，保留建议方向但强制阻断`, supportEvidence: [],
        counterEvidence: [`真实行情处理失败：${safeMessage(error)}`], missingInformation: [],
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
  executions: Array<Pick<PandaSourceExecution, "result">>,
  usedDailyFallback: boolean,
): DataState {
  const hasRows = executions.some((execution) => execution.result.data.length > 0);
  const fullyFreshLive = hasRows
    && !usedDailyFallback
    && executions.every((execution) =>
      execution.result.liveCallSucceeded
      && execution.result.data.length > 0
      && execution.result.fresh
    );

  return fullyFreshLive ? "LIVE_FRESH" : hasRows ? "STALE" : "UNAVAILABLE";
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
    confidence: input.research.dataState === "LIVE_FRESH" ? 0.72 : 0.4,
    rationales: [input.riskFinding.conclusion, input.research.latest ? `最新市场价格 ${input.research.latest.toString()}` : "市场数据不可用时仅保留方向"],
    counterEvidence: [input.research.dataState === "LIVE_FRESH" ? "历史行情不能保证未来走势" : "缺少新鲜真实行情，不能形成可执行建议"],
    risks: ["市场波动可能使参考区间快速失效", "画像或资金用途变化会改变适配性"],
    portfolioImpact: input.targetHolding ? `当前标的权重为 ${new Decimal(input.targetHolding.weight_bps).div(100).toString()}%，执行后必须重算组合与压力测试` : "新增标的会改变现金、集中度和压力损失，执行前必须模拟",
    invalidationConditions: ["画像或持仓发生变化", "数据过期或数据源不可用", "投资逻辑或合规结论发生变化"],
    compliance: { approved: false, decision: "DOWNGRADED", reason: "确定性 fallback 只提出候选，发布状态由服务端计算" },
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

function complianceFindingFor(criticalMissing: string[], dataState: DataState, findings: AgentFinding[]): AgentFinding {
  const blocked = criticalMissing.length > 0;
  const degraded = dataState === "STALE" || dataState === "UNAVAILABLE";
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
}): PublicationStatus {
  if (input.criticalMissing.length || input.candidate.compliance.decision === "BLOCKED" || input.unresolvedConflict) return "BLOCKED";
  if (input.marketDataRequired && input.dataState !== "LIVE_FRESH") return "BLOCKED";
  const hasCounterEvidence = input.findings.some((finding) => finding.counterEvidence.length > 0) && input.candidate.counterEvidence.length > 0;
  const hasPortfolioImpact = input.candidate.portfolioImpact.trim().length > 0;
  const dataRequirementSatisfied = input.dataState === "LIVE_FRESH" || (!input.marketDataRequired && input.dataState === "NOT_REQUIRED");
  if (!input.modelFallback && dataRequirementSatisfied && hasCounterEvidence && hasPortfolioImpact && input.candidate.compliance.approved) return "ACTIVE";
  return "DEGRADED";
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
    reasons: input.candidate.rationales,
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
    },
  };
}

export function buildPortfolioRecommendationDraft(input: {
  status: PublicationStatus;
  candidate: AdvisorDecision;
  profile: Profile | undefined;
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
    },
  };
}

function persistFindings(db: ReturnType<typeof getDatabase>, userId: string, rootRunId: string, findings: AgentFinding[], executions: PandaSourceExecution[]): void {
  const marketExecutions = executions;
  for (const finding of findings) {
    const child = db.prepare("SELECT id FROM agent_runs WHERE root_run_id=? AND agent_type=? ORDER BY created_at DESC LIMIT 1").get(rootRunId, finding.agent.toLowerCase()) as { id?: string } | undefined;
    for (const [stance, statements] of [["support", finding.supportEvidence], ["counter", finding.counterEvidence], ["missing", finding.missingInformation]] as const) {
      for (const statement of statements) {
        const evidenceId = createId("evidence");
        const now = isoNow();
        db.prepare(`INSERT INTO evidence_items
          (id,user_id,recommendation_id,agent_run_id,kind,stance,quality,title,summary,statement,source,is_material,created_at)
          VALUES (?,?,NULL,?,?,?,?,?,?,?,?,1,?)`).run(
          evidenceId, userId, child?.id ?? rootRunId, stance === "missing" ? "missing_data" : finding.agent === "DATA_RESEARCH" ? "market_fact" : "model_inference",
          stance, finding.confidence >= 0.75 ? "high" : finding.confidence >= 0.4 ? "medium" : "low", finding.agent, statement, statement,
          finding.agent === "DATA_RESEARCH" ? "PANDADATA" : "DERIVED_ENGINE", now,
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

export function criticalMissingInformation(intent: AdvisorIntent, profile: Profile | undefined, target: Instrument | null, holding: Holding | null, hasHoldings = true): string[] {
  if (intent !== "BUY" && intent !== "SELL" && intent !== "DIAGNOSIS") return [];
  const preferences = parsePreferences(profile?.preferences_json);
  const profileMissing = [
    !profile?.risk_level ? "risk_level" : null,
    !profile?.investment_amount_decimal ? "investment_amount" : null,
    !profile?.horizon ? "horizon" : null,
    !profile?.max_drawdown_decimal ? "max_drawdown" : null,
    preferences.instrumentPreference === undefined ? "instrument_preference" : null,
    preferences.nearTermUse === undefined ? "near_term_use" : null,
  ].filter((value): value is string => Boolean(value));
  if (intent === "DIAGNOSIS") return [...profileMissing, ...(!hasHoldings ? ["holdings"] : [])];
  return [
    ...profileMissing,
    !target ? "instrument" : null,
    intent === "SELL" && !holding ? "target_holding" : null,
  ].filter((value): value is string => Boolean(value));
}

function rolesFor(intent: AdvisorIntent, hasTarget: boolean, hasHoldings: boolean, content: string): ProfessionalAgentRole[] {
  if (requestsFullAgentLoop(content)) {
    return ["PROFILE_CONTEXT", "DATA_RESEARCH", "PORTFOLIO_RISK", "RECOMMENDATION", "COMPLIANCE_REVIEWER", "EXPLANATION_REPORT"];
  }
  if (intent === "BUY" || intent === "SELL") return ["PROFILE_CONTEXT", "DATA_RESEARCH", "PORTFOLIO_RISK", "RECOMMENDATION", "COMPLIANCE_REVIEWER", "EXPLANATION_REPORT"];
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

function inferIntent(content: string): AdvisorIntent {
  if (/卖出|减仓|止盈|止损|退出|清仓/u.test(content)) return "SELL";
  if (/买入|入场|加仓|追高|试仓|增配|配置/u.test(content)) return "BUY";
  if (/诊断|健康|风险|回撤|浮盈|持仓分析|集中度/u.test(content)) return "DIAGNOSIS";
  return "GENERAL";
}

function directionForIntent(intent: AdvisorIntent): AdvisorDecision["requestedDirection"] {
  if (intent === "BUY") return "BUY";
  if (intent === "SELL") return "SELL";
  if (intent === "DIAGNOSIS") return "ANALYZE";
  return "HOLD";
}

function actionMatchesDirection(action: AdvisorDecision["action"], direction: AdvisorDecision["requestedDirection"]): boolean {
  if (direction === "BUY") return ["WATCH", "TRIAL_BUY", "SCALE_IN", "STOP_ADDING"].includes(action);
  if (direction === "SELL") return ["HOLD", "STOP_ADDING", "SCALE_OUT", "EXIT"].includes(action);
  return ["WATCH", "HOLD", "STOP_ADDING"].includes(action);
}

function chiefPrompt(
  question: string,
  profile: Profile | undefined,
  holdings: Holding[],
  target: Instrument | null,
  research: ResearchState,
  findings: AgentFinding[],
  requiredRoles: ProfessionalAgentRole[],
  semanticContext: AdvisorSemanticToolsContext,
): string {
  const marketFacts = research.executions.map(({ source, result }) => ({
    method: source.method,
    requestedSymbol: source.parameters.symbol,
    rowCount: result.data.length,
    asOfDate: result.asOfDate,
      rows: [...result.data].sort(compareMarketRows).slice(-5),
  }));
  return [
    `用户问题：${question}`,
    `服务端当前时间：${isoNow()}；数据状态由服务端计算，禁止自行改写或臆测数据已过期`,
    `必须委派：${requiredRoles.join(", ")}`,
    `用户画像：${json(profile ?? {})}`,
    `持仓摘要：${json(holdings.map((holding) => ({ symbol: holding.symbol, weightBps: holding.weight_bps, marketValue: holding.market_value_decimal })))}`,
    `目标标的：${json(target)}`,
    `数据状态：${research.dataState}，数据日期：${research.asOfDate ?? "未知"}`,
    `实时/行情数据摘要：${json(research.quotes)}`,
    `服务端历史风险指标：${json({ riskMetrics: research.riskMetrics, correlations: research.correlations })}`,
    `真实行情明细（来自 PandaData，不是行数）：${json(marketFacts)}`,
    `语义层工具上下文：${json(summarizeAdvisorSemanticToolsContext(semanticContext))}`,
    `确定性节点发现：${json(findings)}`,
    "请动态委派并输出结构化候选；服务端会独立执行发布门和方向保护。",
  ].join("\n");
}

function formatAnswer(decision: AdvisorDecision, status: PublicationStatus, findings: AgentFinding[], dataState: DataState): string {
  const research = findings.find((finding) => finding.agent === "DATA_RESEARCH");
  const risk = findings.find((finding) => finding.agent === "PORTFOLIO_RISK");
  const compliance = findings.find((finding) => finding.agent === "COMPLIANCE_REVIEWER");
  return [
    `建议状态：${status}；建议动作：${decision.action}`,
    `核心结论：${decision.summary}`,
    `数据研究：${research?.conclusion ?? `本次不要求外部数据（${dataState}）`}`,
    `组合影响：${decision.portfolioImpact}`,
    `风险复核：${risk?.conclusion ?? "尚未形成组合风险结论"}`,
    `反方证据：${decision.counterEvidence.join("；")}`,
    `合规结论：${compliance?.conclusion ?? decision.compliance.reason}`,
    "建议卡已保存，可在证据包中复核数据来源、反方证据和失效条件。",
  ].join("\n");
}

function formatGuidedIntakeAnswer(messages: string[]): string {
  const context = messages.join("\n");
  const hasInvestmentAmount = /(?:拿(?:出)?|投入|投资|配置|可用于|准备用|计划用)\s*(?:人民币)?\s*\d+(?:\.\d+)?\s*(?:万元|万|元|w)/iu.test(context);
  const hasHorizon = /[一二三四五六七八九十\d]+\s*年|半年|几个月|短期|中期|中线|长期|长线|未来\s*[一二三四五六七八九十\d]+/u.test(context);
  const hasGoal = /首付|买房|购房|教育|养老|退休|应急|结婚|换车|旅行|长期增值|财富增长|目标/u.test(context);
  const hasRiskLimit = /\d+(?:\.\d+)?\s*%|最大.*(?:亏|回撤)|最多.*(?:亏|回撤)|能接受.*(?:亏|回撤)/u.test(context);
  const hasPreference = /宽基|指数|ETF|个股|股票|债券|基金|存款|现金管理/u.test(context);
  const questions = [
    !hasInvestmentAmount ? "在保留应急金和近期支出后，你准备拿出多少作为可投资金额？" : null,
    !hasHorizon ? "这部分投资资金预计多久不会使用：1 年以内、1-3 年，还是 3 年以上？" : null,
    !hasGoal ? "你更想优先实现哪个目标：稳住本金、阶段性大额支出，还是长期增值？" : null,
    !hasRiskLimit ? "账户短期下跌多少时会明显影响你的生活或让你想立刻卖出？" : null,
    !hasPreference ? "你更愿意从宽基指数、债券/现金管理，还是个股研究开始？" : null,
  ].filter((question): question is string => Boolean(question));

  if (questions.length === 0) {
    return [
      "这轮对话里的可投资金额、期限、目标、回撤边界和方向偏好已经比较清楚了。",
      "下一步可以先整理不涉及具体标的的资金分层方案；只有你明确提出“诊断我的持仓”或“分析某个标的”时，才会启动完整的数据、风险与合规流程并形成建议卡。",
    ].join("\n");
  }

  return [
    messages.length > 1
      ? "我把你刚补充的内容接上了。普通模式会继续把关键信息问完整，不会中途跳去生成买卖建议。"
      : "收到。普通模式会先把目标、资金用途和风险边界聊清楚，不会因为一条描述就读取历史持仓并生成买卖建议。",
    `接下来确认${questions.length > 1 ? "两件事" : "一件事"}：`,
    ...questions.slice(0, 2).map((question, index) => `${index + 1}. ${question}`),
    "你回答后，我会沿着当前对话继续往下梳理。",
  ].join("\n");
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

function extractSymbol(content: string): string | null {
  return content.toUpperCase().match(/\b(?:\d{6}(?:\.(?:SH|SZ|OF))?|\d{5}\.HK|[A-Z]{1,10}(?:\.(?:US|HK))?)\b/u)?.[0] ?? null;
}

function findInstrumentBySymbol(instruments: Instrument[], symbol: string): Instrument | null {
  const normalized = normalizeSymbol(symbol);
  return instruments.find((instrument) => normalizeSymbol(instrument.symbol) === normalized) ?? null;
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
