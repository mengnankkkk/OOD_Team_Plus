import Decimal from "decimal.js";

import { runChiefAdvisor } from "@/mastra/agents/chief-advisor";
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
  execution: PandaSourceExecution | null;
  closes: Decimal[];
  latest: Decimal | null;
  asOfDate: string | null;
};

export type ProfessionalAdvisorResult = {
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
  const snapshot = db.prepare("SELECT * FROM portfolio_snapshots WHERE user_id=? ORDER BY as_of DESC,created_at DESC LIMIT 1").get(input.userId) as Record<string, unknown> | undefined;
  const holdings = snapshot ? db.prepare(`SELECT hs.instrument_id,i.symbol,i.name,i.asset_type,i.sector,
      hs.quantity_decimal,hs.cost_decimal,hs.price_decimal,hs.market_value_decimal,hs.unrealized_pnl_decimal,hs.weight_bps
    FROM holding_snapshots hs JOIN instruments i ON i.id=hs.instrument_id
    WHERE hs.portfolio_snapshot_id=? ORDER BY hs.weight_bps DESC`).all(snapshot.id) as Holding[] : [];
  const instruments = db.prepare("SELECT id,symbol,name,asset_type,market FROM instruments WHERE tradable=1 ORDER BY symbol").all() as Instrument[];
  const intent = inferIntent(input.content);
  const requestedDirection = directionForIntent(intent);
  const targetSymbol = input.targetSymbol ?? extractSymbol(input.content);
  const target = targetSymbol ? instruments.find((instrument) => instrument.symbol.toUpperCase() === targetSymbol.toUpperCase()) ?? null : null;
  const targetHolding = target ? holdings.find((holding) => holding.instrument_id === target.id) ?? null : null;
  const requiredRoles = rolesFor(intent, Boolean(target));
  const findings: AgentFinding[] = [];

  try {
    const profileFinding = await runRole(db, input, "PROFILE_CONTEXT", () => profileFindingFor(profile));
    findings.push(profileFinding);

    let research: ResearchState = { dataState: target ? "UNAVAILABLE" : "NOT_REQUIRED", execution: null, closes: [], latest: null, asOfDate: null };
    if (requiredRoles.includes("DATA_RESEARCH")) {
      const researchFinding = await runRole(db, input, "DATA_RESEARCH", async (childRunId) => {
        const result = await researchInstrument(db, input.analysisId, childRunId, target);
        research = result.state;
        return result.finding;
      });
      findings.push(researchFinding);
    }

    const riskFinding = await runRole(db, input, "PORTFOLIO_RISK", () => portfolioRiskFinding(holdings, snapshot));
    findings.push(riskFinding);

    const deterministicDecision = deterministicDecisionFor({ intent, requestedDirection, target, targetHolding, profile, research, riskFinding });
    if (requiredRoles.includes("RECOMMENDATION")) {
      findings.push(await runRole(db, input, "RECOMMENDATION", () => recommendationFinding(deterministicDecision, findings)));
    }

    const criticalMissing = criticalMissingInformation(intent, profile, target, targetHolding);
    const complianceFinding = complianceFindingFor(criticalMissing, research.dataState, findings);
    if (requiredRoles.includes("COMPLIANCE_REVIEWER")) {
      findings.push(await runRole(db, input, "COMPLIANCE_REVIEWER", () => complianceFinding));
    }

    let candidate = deterministicDecision;
    let provider: ProfessionalAdvisorResult["provider"] = "DETERMINISTIC_FALLBACK";
    let modelFallback = true;
    let unresolvedConflict = false;
    if (process.env.DEEPSEEK_API_KEY?.trim()) {
      try {
        const model = await runChiefAdvisor({
          prompt: chiefPrompt(input.content, profile, holdings, target, research, findings, requiredRoles),
          requiredAgents: requiredRoles.filter((role) => role !== "EXPLANATION_REPORT"),
          onAgentStarted: (agent, label) => persistSseEvent({ analysisId: input.analysisId, type: "agent.delegated", payload: { agent, label } }),
          onAgentCompleted: (finding) => persistSseEvent({ analysisId: input.analysisId, type: "agent.completed", payload: { agent: finding.agent, conclusion: finding.conclusion } }),
        });
        const preserved = preserveDirection(model.decision, deterministicDecision);
        unresolvedConflict = preserved.conflict;
        candidate = preserved.decision;
        if (unresolvedConflict) persistConflict(db, input.analysisId, candidate, model.decision);
        provider = "CHIEF_ADVISOR";
        modelFallback = false;
      } catch (error) {
        persistSseEvent({ analysisId: input.analysisId, type: "agent.failed", payload: { code: "MODEL_UNAVAILABLE", retryable: true } });
        db.prepare("UPDATE agent_runs SET model_provider='deterministic',failure_code=?,failure_message=? WHERE id=?")
          .run("MODEL_UNAVAILABLE", safeMessage(error), input.analysisId);
      }
    }

    const status = enforcePublicationStatus({
      candidate,
      criticalMissing,
      dataState: research.dataState,
      findings,
      modelFallback,
      unresolvedConflict,
    });
    const recommendation = target
      ? buildRecommendationDraft({ status, candidate, target, holding: targetHolding, profile, research, snapshot })
      : null;
    persistFindings(db, input.userId, input.analysisId, findings, research.execution);
    db.prepare("UPDATE agent_runs SET model_provider=?,model_name=?,output_summary=?,compliance_json=? WHERE id=?")
      .run(provider === "CHIEF_ADVISOR" ? "deepseek" : "deterministic", process.env.DEEPSEEK_MODEL ?? null,
        candidate.summary, json({ status, approved: status === "ACTIVE", simulationOnly: true }), input.analysisId);
    persistSseEvent({ analysisId: input.analysisId, type: "compliance.completed", payload: { status, dataState: research.dataState, modelFallback, unresolvedConflict } });
    const missingInformation = [...new Set([...criticalMissing, ...findings.flatMap((finding) => finding.missingInformation)])];
    return {
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
): Promise<AgentFinding> {
  const childRunId = createId("agent_run");
  const startedAt = isoNow();
  db.prepare(`INSERT INTO agent_runs
    (id,user_id,type,status,session_id,parent_run_id,root_run_id,agent_type,objective,started_at,created_at)
    VALUES (?,?,'professional_agent','running',?,?,?,?,?,?,?)`).run(
    childRunId, input.userId, input.sessionId, input.analysisId, input.analysisId, role.toLowerCase(), role, startedAt, startedAt,
  );
  persistSseEvent({ analysisId: input.analysisId, type: "agent.delegated", payload: { agent: role, childRunId } });
  try {
    const finding = AgentFindingSchema.parse(await operation(childRunId));
    db.prepare("UPDATE agent_runs SET status='completed',completed_at=?,output_summary=?,result_json=? WHERE id=?")
      .run(isoNow(), finding.conclusion, json(finding), childRunId);
    persistSseEvent({ analysisId: input.analysisId, type: "agent.completed", payload: { agent: role, childRunId, conclusion: finding.conclusion } });
    return finding;
  } catch (error) {
    db.prepare("UPDATE agent_runs SET status='failed',completed_at=?,failure_code='AGENT_NODE_FAILED',failure_message=? WHERE id=?")
      .run(isoNow(), safeMessage(error), childRunId);
    persistSseEvent({ analysisId: input.analysisId, type: "agent.failed", payload: { agent: role, childRunId, code: "AGENT_NODE_FAILED" } });
    throw error;
  }
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
): Promise<{ finding: AgentFinding; state: ResearchState }> {
  if (!target) return {
    state: { dataState: "UNAVAILABLE", execution: null, closes: [], latest: null, asOfDate: null },
    finding: AgentFindingSchema.parse({
      agent: "DATA_RESEARCH", conclusion: "未识别到可研究标的", supportEvidence: [], counterEvidence: ["没有明确标的时不能形成个股买卖结论"],
      missingInformation: ["instrument"], risks: ["标的歧义可能导致错误数据关联"], confidence: 0.2, needsAnotherAgent: false,
    }),
  };
  const end = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - 180);
  const source: PandaQuerySource = {
    dataset: marketDataset(target),
    method: marketMethod(target),
    parameters: { symbol: [target.symbol], start_date: startDate.toISOString().slice(0, 10).replaceAll("-", ""), end_date: end, fields: ["symbol", "date", "open", "high", "low", "close", "volume", "amount"] },
    columns: ["symbol", "date", "open", "high", "low", "close", "volume", "amount"],
    joinKeys: ["symbol", "date"],
    assetType: target.asset_type.toUpperCase(),
  };
  persistSseEvent({ analysisId: rootRunId, type: "tool.started", payload: { toolName: source.method, childRunId } });
  try {
    const [execution] = await executePandaSources({ sources: [source], agentRunId: childRunId, localRows: [], db });
    const closes = execution.result.data.map((row) => decimal(row.close)).filter((value): value is Decimal => value !== null);
    const latest = closes.at(-1) ?? null;
    const dataState: DataState = execution.result.fresh && execution.result.liveCallSucceeded ? "LIVE_FRESH" : "STALE";
    persistSseEvent({ analysisId: rootRunId, type: "tool.completed", payload: { toolName: source.method, childRunId, rowCount: execution.result.data.length, dataState } });
    return {
      state: { dataState, execution, closes, latest, asOfDate: execution.result.asOfDate },
      finding: AgentFindingSchema.parse({
        agent: "DATA_RESEARCH",
        conclusion: `${target.symbol} 已完成 ${execution.result.data.length} 条真实市场数据研究，状态为 ${dataState}`,
        supportEvidence: [latest ? `最新收盘价：${latest.toString()}` : "市场接口已完成 live call", `数据日期：${execution.result.asOfDate ?? "未知"}`],
        counterEvidence: [dataState === "LIVE_FRESH" ? "历史价格不能保证未来走势" : "数据已过期，禁止生成 ACTIVE 建议"],
        missingInformation: latest ? [] : ["close"],
        risks: ["短期价格和成交量可能快速变化", "财务或估值字段缺失时不会推导替代值"],
        confidence: dataState === "LIVE_FRESH" && latest ? 0.82 : 0.4,
        needsAnotherAgent: true,
        suggestedNextAgent: "PORTFOLIO_RISK",
      }),
    };
  } catch (error) {
    persistSseEvent({ analysisId: rootRunId, type: "tool.failed", payload: { toolName: source.method, childRunId, code: "PANDADATA_UNAVAILABLE" } });
    return {
      state: { dataState: "UNAVAILABLE", execution: null, closes: [], latest: null, asOfDate: null },
      finding: AgentFindingSchema.parse({
        agent: "DATA_RESEARCH", conclusion: `${target.symbol} 的 PandaData live call 不可用，保留建议方向但强制降级`, supportEvidence: [],
        counterEvidence: ["认证、网络、SDK 或上游服务失败，dry-run 不能作为真实行情"], missingInformation: [],
        risks: ["缺少新鲜行情时参考区间和触发价不可执行"], confidence: 0.2, needsAnotherAgent: true, suggestedNextAgent: "COMPLIANCE_REVIEWER",
      }),
    };
  }
}

function portfolioRiskFinding(holdings: Holding[], snapshot: Record<string, unknown> | undefined): AgentFinding {
  const values = holdings.map((holding) => decimal(holding.market_value_decimal) ?? new Decimal(0));
  const invested = Decimal.sum(...(values.length ? values : [new Decimal(0)]));
  const weights = invested.gt(0) ? values.map((value) => value.div(invested)) : [];
  const largest = weights.reduce((current, value) => Decimal.max(current, value), new Decimal(0));
  const hhi = weights.reduce((sum, weight) => sum.plus(weight.pow(2)), new Decimal(0));
  return AgentFindingSchema.parse({
    agent: "PORTFOLIO_RISK",
    conclusion: holdings.length ? `组合非现金持仓 ${holdings.length} 项，最大持仓权重 ${largest.mul(100).toDecimalPlaces(2).toString()}%，HHI ${hhi.toDecimalPlaces(4).toString()}` : "当前没有可用于组合风险计算的持仓",
    supportEvidence: holdings.length ? [`组合快照：${String(snapshot?.id ?? "未知")}`, "集中度计算明确排除现金"] : [],
    counterEvidence: [holdings.length ? "单一快照不能替代完整历史回撤和相关性分析" : "缺少持仓时不能评估卖出影响"],
    missingInformation: holdings.length ? [] : ["holdings"],
    risks: [largest.gte("0.5") ? "单一持仓波动可能主导组合回撤" : "行业相关性仍可能放大组合波动"],
    confidence: holdings.length ? 0.78 : 0.2,
    needsAnotherAgent: true,
    suggestedNextAgent: "RECOMMENDATION",
  });
}

function deterministicDecisionFor(input: {
  intent: AdvisorIntent;
  requestedDirection: AdvisorDecision["requestedDirection"];
  target: Instrument | null;
  targetHolding: Holding | null;
  profile: Profile | undefined;
  research: ResearchState;
  riskFinding: AgentFinding;
}): AdvisorDecision {
  const action: AdvisorDecision["action"] = input.intent === "BUY"
    ? input.targetHolding ? "SCALE_IN" : input.target ? "TRIAL_BUY" : "WATCH"
    : input.intent === "SELL"
      ? input.targetHolding ? "SCALE_OUT" : "HOLD"
      : input.targetHolding ? "HOLD" : "WATCH";
  return AdvisorDecisionSchema.parse({
    action,
    requestedDirection: input.requestedDirection,
    summary: input.target ? `${input.target.symbol} 需要在画像、真实数据、组合风险和合规条件下进行条件化决策` : "先完成画像与组合诊断，再形成具体标的建议",
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
    conclusion: blocked ? "关键信息缺失，发布门阻断" : degraded ? "数据条件不满足，发布门降级" : "基础合规检查通过，仍需服务端最终门控",
    supportEvidence: ["建议仅用于模拟，不创建真实订单", `已检查 ${findings.length} 个专业节点`],
    counterEvidence: [blocked ? `缺失：${criticalMissing.join(", ")}` : degraded ? "没有可用的新鲜 live 数据" : "模型结论仍不能覆盖服务端风险规则"],
    missingInformation: criticalMissing,
    risks: ["用户可能把模拟建议误解为确定性交易指令"],
    confidence: 0.95,
    needsAnotherAgent: false,
  });
}

function enforcePublicationStatus(input: {
  candidate: AdvisorDecision;
  criticalMissing: string[];
  dataState: DataState;
  findings: AgentFinding[];
  modelFallback: boolean;
  unresolvedConflict: boolean;
}): PublicationStatus {
  if (input.criticalMissing.length || input.candidate.compliance.decision === "BLOCKED" || input.unresolvedConflict) return "BLOCKED";
  const hasCounterEvidence = input.findings.some((finding) => finding.counterEvidence.length > 0) && input.candidate.counterEvidence.length > 0;
  const hasPortfolioImpact = input.candidate.portfolioImpact.trim().length > 0;
  if (!input.modelFallback && input.dataState === "LIVE_FRESH" && hasCounterEvidence && hasPortfolioImpact && input.candidate.compliance.approved) return "ACTIVE";
  return "DEGRADED";
}

function preserveDirection(model: AdvisorDecision, fallback: AdvisorDecision): { decision: AdvisorDecision; conflict: boolean } {
  const expected = fallback.requestedDirection;
  const allowed = actionMatchesDirection(model.action, expected);
  const sameDirection = model.requestedDirection === expected;
  if (allowed && sameDirection) return { decision: model, conflict: false };
  return { decision: { ...model, action: fallback.action, requestedDirection: expected, summary: fallback.summary }, conflict: true };
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
      suggestedReduction: reduction?.toString() ?? null,
      modelCannotOverridePublicationGate: true,
    },
  };
}

function persistFindings(db: ReturnType<typeof getDatabase>, userId: string, rootRunId: string, findings: AgentFinding[], execution: PandaSourceExecution | null): void {
  const sourceId = execution ? "source-pandadata-api" : "source-derived-engine";
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
        db.prepare(`INSERT INTO evidence_source_links
          (id,evidence_id,data_source_id,tool_call_id,market_snapshot_id,source_locator,excerpt,created_at)
          VALUES (?,?,?,?,?,?,?,?)`).run(
          createId("evidence_link"), evidenceId, sourceId, finding.agent === "DATA_RESEARCH" ? execution?.toolCallId ?? null : null,
          finding.agent === "DATA_RESEARCH" ? execution?.marketSnapshotIds.at(-1) ?? null : null,
          finding.agent === "DATA_RESEARCH" ? execution?.source.method ?? "pandadata-unavailable" : `agent:${finding.agent}`, statement.slice(0, 500), now,
        );
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

function criticalMissingInformation(intent: AdvisorIntent, profile: Profile | undefined, target: Instrument | null, holding: Holding | null): string[] {
  if (intent !== "BUY" && intent !== "SELL") return [];
  const preferences = parsePreferences(profile?.preferences_json);
  return [
    !profile?.risk_level ? "risk_level" : null,
    !profile?.investment_amount_decimal ? "investment_amount" : null,
    !profile?.horizon ? "horizon" : null,
    !profile?.max_drawdown_decimal ? "max_drawdown" : null,
    preferences.instrumentPreference === undefined ? "instrument_preference" : null,
    preferences.nearTermUse === undefined ? "near_term_use" : null,
    !target ? "instrument" : null,
    intent === "SELL" && !holding ? "target_holding" : null,
  ].filter((value): value is string => Boolean(value));
}

function rolesFor(intent: AdvisorIntent, hasTarget: boolean): ProfessionalAgentRole[] {
  if (intent === "BUY" || intent === "SELL") return ["PROFILE_CONTEXT", "DATA_RESEARCH", "PORTFOLIO_RISK", "RECOMMENDATION", "COMPLIANCE_REVIEWER"];
  if (intent === "DIAGNOSIS") return ["PROFILE_CONTEXT", "PORTFOLIO_RISK", "COMPLIANCE_REVIEWER"];
  return hasTarget ? ["PROFILE_CONTEXT", "DATA_RESEARCH", "PORTFOLIO_RISK", "COMPLIANCE_REVIEWER"] : ["PROFILE_CONTEXT", "PORTFOLIO_RISK", "COMPLIANCE_REVIEWER"];
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

function chiefPrompt(question: string, profile: Profile | undefined, holdings: Holding[], target: Instrument | null, research: ResearchState, findings: AgentFinding[], requiredRoles: ProfessionalAgentRole[]): string {
  return [
    `用户问题：${question}`,
    `必须委派：${requiredRoles.join(", ")}`,
    `用户画像：${json(profile ?? {})}`,
    `持仓摘要：${json(holdings.map((holding) => ({ symbol: holding.symbol, weightBps: holding.weight_bps, marketValue: holding.market_value_decimal })))}`,
    `目标标的：${json(target)}`,
    `数据状态：${research.dataState}，数据日期：${research.asOfDate ?? "未知"}`,
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
    "仅支持模拟采纳，不连接券商，不创建真实订单。",
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

function extractSymbol(content: string): string | null {
  return content.toUpperCase().match(/\b(?:\d{6}\.(?:SH|SZ|OF)|\d{5}\.HK|[A-Z]{1,10}(?:\.(?:US|HK))?)\b/u)?.[0] ?? null;
}

function marketDataset(target: Instrument): PandaQuerySource["dataset"] {
  if (target.asset_type.toUpperCase().includes("FUND") || target.asset_type.toUpperCase().includes("ETF")) return "MARKET_FUND_DAILY";
  if (target.asset_type.toUpperCase().includes("INDEX")) return "MARKET_INDEX_DAILY";
  if (target.market.toUpperCase() === "US") return "MARKET_US_DAILY";
  if (target.market.toUpperCase() === "HK") return "MARKET_HK_DAILY";
  return "MARKET_STOCK_DAILY";
}

function marketMethod(target: Instrument): PandaQuerySource["method"] {
  const dataset = marketDataset(target);
  switch (dataset) {
    case "MARKET_FUND_DAILY": return "get_fund_daily";
    case "MARKET_INDEX_DAILY": return "get_index_daily";
    case "MARKET_US_DAILY": return "get_us_daily";
    case "MARKET_HK_DAILY": return "get_hk_daily";
    default: return "get_stock_daily";
  }
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
