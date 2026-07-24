import { isoNow } from "@/server/http/context";

import type { AdvisorContext, ProfileRow, RecommendationDraft } from "./types";

export type AdvisorIntent = "BUY" | "SELL" | "DIAGNOSIS" | "QUERY" | "GENERAL";

export function classifyIntent(content: string): AdvisorIntent {
  if (/(卖出|减仓|止盈|止损|退出|清仓|落袋)/u.test(content)) return "SELL";
  if (/(买入|入场|加仓|追高|试仓|增配|配置)/u.test(content)) return "BUY";
  if (/(诊断|健康|风险|回撤|浮盈|持仓分析|集中度)/u.test(content)) return "DIAGNOSIS";
  if (/(多少|查询|统计|列表|SQL|sql)/u.test(content)) return "QUERY";
  return "GENERAL";
}

export function selectTarget(content: string, context: AdvisorContext) {
  const normalized = content.toUpperCase();
  const instrument = context.instruments.find((item) => normalized.includes(item.symbol.toUpperCase()) || (item.name && content.includes(item.name)));
  if (!instrument) return null;
  return { instrument, holding: context.holdings.find((holding) => holding.instrument_id === instrument.id) ?? null };
}

export function buildRecommendation(intent: "BUY" | "SELL", target: ReturnType<typeof selectTarget> & object, context: AdvisorContext): RecommendationDraft {
  const instrument = target.instrument;
  if (!instrument) throw new Error("Instrument not found");
  const holding = target.holding;
  const riskLevel = String(context.profile?.risk_level ?? "BALANCED").toUpperCase();
  const horizon = normalizeHorizon(context.profile?.horizon);
  const maxPosition = riskLevel === "CONSERVATIVE" ? 0.1 : riskLevel === "AGGRESSIVE" ? 0.3 : 0.2;
  const firstPosition = riskLevel === "CONSERVATIVE" ? 0.03 : riskLevel === "AGGRESSIVE" ? 0.1 : 0.05;
  const maxDrawdown = Math.abs(Number(context.profile?.max_drawdown_decimal ?? (riskLevel === "CONSERVATIVE" ? 0.08 : riskLevel === "AGGRESSIVE" ? 0.2 : 0.12)));
  const price = Number(holding?.price_decimal ?? instrument.latest_price ?? 0);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Current market price is unavailable");
  const weight = Number(holding?.weight_bps ?? 0) / 10_000;
  const pnlRate = holding && Number(holding.cost_decimal) > 0
    ? Number(holding.unrealized_pnl_decimal) / (Number(holding.cost_decimal) * Number(holding.quantity_decimal))
    : 0;
  const dataQuality = String(context.snapshot?.data_quality ?? "unknown").toLowerCase();
  const staleOrFixture = dataQuality !== "complete";
  let action: RecommendationDraft["action"];
  if (staleOrFixture) action = intent === "BUY" ? "WATCH" : "HOLD";
  else if (intent === "BUY") action = weight >= maxPosition ? "STOP_ADDING" : weight > 0 ? "SCALE_IN" : "TRIAL_BUY";
  else if (pnlRate <= -maxDrawdown * 1.5) action = "EXIT";
  else if (pnlRate <= -maxDrawdown || pnlRate >= 0.15 || weight > maxPosition) action = "SCALE_OUT";
  else action = "HOLD";
  const complianceStatus = staleOrFixture ? "DEGRADED" : "PASSED";
  const suitability = action === "STOP_ADDING" || action === "EXIT" ? "HIGH" : weight <= maxPosition ? "MEDIUM" : "LOW";
  const validDays = horizon === "SHORT" ? 7 : horizon === "LONG" ? 90 : 30;
  const expiresAt = new Date(Date.now() + validDays * 86_400_000).toISOString();
  const lower = price * 0.95;
  const upper = price * 1.03;
  const stopLoss = price * (1 - Math.min(maxDrawdown, 0.25));
  const takeProfit = price * (1 + (riskLevel === "CONSERVATIVE" ? 0.1 : riskLevel === "AGGRESSIVE" ? 0.25 : 0.15));
  const reasons = [
    `当前价格 ${price.toFixed(2)}，现有仓位约 ${(weight * 100).toFixed(1)}%。`,
    `用户风险等级为 ${riskLevel}，单一标的仓位上限按 ${(maxPosition * 100).toFixed(0)}% 控制。`,
    `当前持仓浮动收益率约 ${(pnlRate * 100).toFixed(1)}%，建议采用可撤回的分批方案。`,
  ];
  const counterEvidence = [staleOrFixture
    ? `当前快照质量为 ${dataQuality.toUpperCase()}，不能据此形成可执行交易结论。`
    : "历史价格和当前组合指标不能保证未来走势，市场环境可能快速变化。"];
  const risks = ["市场波动可能使参考区间和止损条件快速失效。", "单一标的或行业集中度上升会放大组合回撤。", "该建议不包含税费、滑点和真实成交约束。"];
  return {
    instrumentId: instrument.id,
    symbol: instrument.symbol,
    action,
    suitability,
    summary: `${instrument.symbol}：${actionLabel(action)}。`,
    confidence: staleOrFixture ? "0.35" : "0.68",
    positionRange: ["0%", `${(maxPosition * 100).toFixed(0)}%`],
    firstPosition: intent === "BUY" && !staleOrFixture ? `${(firstPosition * 100).toFixed(0)}%` : null,
    addConditions: intent === "BUY" ? [`价格进入 ${lower.toFixed(2)}-${upper.toFixed(2)} 观察区间`, `组合中该标的权重低于 ${(maxPosition * 100).toFixed(0)}%`] : [],
    referenceRange: [lower.toFixed(2), upper.toFixed(2)],
    stopLoss: `价格低于 ${stopLoss.toFixed(2)}，或投资逻辑、流动性条件发生实质变化`,
    takeProfit: `价格达到 ${takeProfit.toFixed(2)}，或组合权重超过 ${(maxPosition * 100).toFixed(0)}% 时再平衡`,
    horizon,
    expiresAt,
    reasons,
    counterEvidence,
    risks,
    alternatives: ["宽基 ETF", "低波动资产", "继续持有现金并等待数据更新"],
    invalidation: "画像、持仓、价格数据更新，或标的基本投资逻辑发生实质变化时建议失效。",
    compliance: { status: complianceStatus, reasons: staleOrFixture ? ["市场数据不是完整实时快照，建议已降级为观察或持有。"] : [], disclaimer: defaultDisclaimer() },
    dataAsOf: String(context.snapshot?.as_of ?? isoNow()),
    provenance: { engine: "deterministic-advisor-v1", dataQuality: dataQuality.toUpperCase(), snapshotId: context.snapshot?.id ?? null, modelMayExplainButCannotOverride: true },
  };
}

export function buildDeterministicAnswer(intent: AdvisorIntent, context: AdvisorContext, recommendation: RecommendationDraft | null) {
  if (recommendation) {
    return [
      `结论：${recommendation.summary}`,
      `建议仓位：${recommendation.positionRange.join("-")}；首笔：${recommendation.firstPosition ?? "暂不新增"}。`,
      `参考区间：${recommendation.referenceRange.join("-")}；${recommendation.stopLoss}。`,
      `主要依据：${recommendation.reasons.slice(0, 3).join("；")}`,
      `反方证据：${recommendation.counterEvidence[0]}`,
      `风险与替代：${recommendation.risks.slice(0, 2).join("；")}；可考虑${recommendation.alternatives.join("、")}。`,
      recommendation.compliance.status === "DEGRADED" ? `合规降级：${recommendation.compliance.reasons.join("；")}` : recommendation.compliance.disclaimer,
    ].join("\n");
  }
  const totalValue = context.holdings.reduce((sum, holding) => sum + Number(holding.market_value_decimal), 0);
  const totalPnl = context.holdings.reduce((sum, holding) => sum + Number(holding.unrealized_pnl_decimal), 0);
  const largest = context.holdings[0];
  if (intent === "DIAGNOSIS" || intent === "QUERY") {
    return `当前持仓市值约 ${totalValue.toFixed(2)}，浮动盈亏约 ${totalPnl.toFixed(2)}。${largest ? `最大持仓为 ${largest.symbol}，权重约 ${(Number(largest.weight_bps) / 100).toFixed(1)}%。` : "尚无持仓。"} 数据日期：${String(context.snapshot?.as_of ?? "未知")}。`;
  }
  return `我已加载你的画像、目标和持仓。当前共有 ${context.holdings.length} 个持仓、${context.goals.length} 个有效目标。你可以继续询问具体标的的入场、持有、减仓、止损止盈或组合风险。`;
}

export function missingProfileQuestions(profile: ProfileRow | null): string[] {
  const questions: string[] = [];
  if (!profile?.risk_level) questions.push("你能接受的风险等级是稳健、平衡还是进取？");
  if (!profile?.investment_amount_decimal) questions.push("这次计划投入多少资金？");
  if (!profile?.horizon) questions.push("计划持有多久：短线、中线还是长线？");
  if (!profile?.max_drawdown_decimal) questions.push("最大可以接受多少回撤？");
  const preferences = parsePreferences(profile?.preferences_json);
  if (preferences.instrumentPreference === undefined) questions.push("偏好个股、行业 ETF 还是宽基指数？");
  if (preferences.nearTermUse === undefined) questions.push("这笔钱近期是否需要使用？");
  return questions;
}

export function normalizeOutputMode(value: string | undefined): "SQL_ONLY" | "CHART" | "FINANCIAL_REPORT" {
  const normalized = value?.toUpperCase();
  return normalized === "CHART" || normalized === "FINANCIAL_REPORT" ? normalized : "SQL_ONLY";
}

export function defaultDisclaimer() {
  return "本结果用于投资研究和方案模拟，不构成收益承诺，不会创建真实订单，最终决策由用户自行作出。";
}

function normalizeHorizon(value: unknown): "SHORT" | "MEDIUM" | "LONG" {
  return value === "SHORT" || value === "LONG" ? value : "MEDIUM";
}

function parsePreferences(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function actionLabel(action: RecommendationDraft["action"]): string {
  const labels: Record<RecommendationDraft["action"], string> = { WATCH: "观察", TRIAL_BUY: "试仓", SCALE_IN: "分批增配", HOLD: "持有", STOP_ADDING: "停止加仓", SCALE_OUT: "分批减仓", EXIT: "退出" };
  return labels[action];
}
