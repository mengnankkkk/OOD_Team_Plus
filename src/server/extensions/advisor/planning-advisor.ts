import { DEFAULT_DEEPSEEK_API_URL, DEFAULT_DEEPSEEK_MODEL } from "./model-config";

type PlanningProfile = {
  risk_level?: string | null;
  investment_amount_decimal?: string | null;
  horizon?: string | null;
  max_drawdown_decimal?: string | null;
  preferences_json?: string | null;
};

type PlanningHolding = {
  symbol: string;
  name: string;
  market_value_decimal: string;
  weight_bps: number;
};

export type FinancialPlanningResult = {
  answer: string;
  provider: "PLANNING_ADVISOR" | "DETERMINISTIC_FALLBACK";
  modelName: string | null;
};

export async function runFinancialPlanningAdvisor(input: {
  question: string;
  messages: string[];
  profile: PlanningProfile | undefined;
  goals: object[];
  holdings: PlanningHolding[];
}): Promise<FinancialPlanningResult> {
  const fallback = deterministicFinancialPlan(input);
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) return { answer: fallback, provider: "DETERMINISTIC_FALLBACK", modelName: null };

  const modelName = process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL;
  try {
    const response = await fetch(chatCompletionsEndpoint(process.env.DEEPSEEK_API_URL ?? DEFAULT_DEEPSEEK_API_URL), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelName,
        temperature: 0.2,
        max_tokens: 1_200,
        messages: [
          {
            role: "system",
            content: [
              "你是 Money Whisperer 的个人理财规划顾问。",
              "直接回答用户当前的问题，并结合给定的画像、目标和本轮对话提供能执行的方案。",
              "普通规划阶段只讨论现金流、应急金、目标资金、资产类别比例、分批投入、再平衡和风险边界。",
              "不得推荐具体股票、基金代码或买卖动作；不得假装读取了实时行情。",
              "缺少信息时明确写出假设，最多追问一个最关键问题，不要重复已经问过的问题。",
              "回答使用自然中文，先给结论，再给分层方案和执行步骤，不要提及内部工作流、意图分类或 Agent。",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              currentQuestion: input.question,
              conversation: input.messages.slice(-8),
              profile: input.profile ?? {},
              goals: input.goals.slice(0, 3),
              portfolioSummary: input.holdings.map((holding) => ({
                symbol: holding.symbol,
                name: holding.name,
                marketValue: holding.market_value_decimal,
                weightPercent: Number(holding.weight_bps) / 100,
              })),
              deterministicFallback: fallback,
            }),
          },
        ],
      }),
    });
    if (!response.ok) return { answer: fallback, provider: "DETERMINISTIC_FALLBACK", modelName: null };
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const answer = payload.choices?.[0]?.message?.content?.trim();
    return answer
      ? { answer, provider: "PLANNING_ADVISOR", modelName }
      : { answer: fallback, provider: "DETERMINISTIC_FALLBACK", modelName: null };
  } catch {
    return { answer: fallback, provider: "DETERMINISTIC_FALLBACK", modelName: null };
  }
}

export function deterministicFinancialPlan(input: {
  messages: string[];
  profile: PlanningProfile | undefined;
}): string {
  const preferences = parsePreferences(input.profile?.preferences_json);
  const plannedInvestment = extractPlannedInvestment(input.messages)
    ?? positiveNumber(input.profile?.investment_amount_decimal)
    ?? 0;
  const monthlyExpense = positiveNumber(preferences.monthlyExpense);
  const emergencyMonths = Math.max(3, Math.min(12, positiveNumber(preferences.emergencyTargetMonths) ?? 6));
  const emergencyTarget = monthlyExpense ? monthlyExpense * emergencyMonths : null;
  const maxDrawdown = positiveNumber(input.profile?.max_drawdown_decimal);
  const equityWeight = equityAllocation(input.profile?.risk_level, maxDrawdown);
  const cashWeight = maxDrawdown !== null && maxDrawdown <= 0.1 ? 30 : 20;
  const fixedIncomeWeight = 100 - equityWeight - cashWeight;

  const allocation = plannedInvestment > 0
    ? [
        `现金管理 ${cashWeight}%（约 ${money(plannedInvestment * cashWeight / 100)}）`,
        `中短久期固收 ${fixedIncomeWeight}%（约 ${money(plannedInvestment * fixedIncomeWeight / 100)}）`,
        `宽基权益 ${equityWeight}%（约 ${money(plannedInvestment * equityWeight / 100)}）`,
      ].join("；")
    : `现金管理 ${cashWeight}%、中短久期固收 ${fixedIncomeWeight}%、宽基权益 ${equityWeight}%`;

  return [
    "可以。先按目前信息给你一版不涉及具体标的的个人理财方案。",
    "一、资金分层",
    emergencyTarget
      ? `1. 安全层：先保留约 ${money(emergencyTarget)}，覆盖 ${emergencyMonths} 个月必要支出；这部分不承担净值波动。`
      : `1. 安全层：先留出 ${emergencyMonths} 个月必要支出作为应急金，放在高流动性、低波动工具中。`,
    "2. 目标层：未来 1-3 年确定要用的钱单独管理，不进入权益仓位。",
    `3. 增长层：对确认可以长期不用的资金，可先采用 ${allocation} 的起始结构。`,
    "二、执行顺序",
    "1. 先把安全层和目标层金额划出，再确定真正可投资金额。",
    "2. 增长层分 3-6 次投入，不因短期涨跌临时提高风险。",
    "3. 每季度或偏离目标比例 5 个百分点时再平衡一次。",
    "三、风险边界",
    `当前方案把权益比例控制在 ${equityWeight}% 左右；如果实际可接受回撤低于现有画像，应继续下调权益比例。`,
    "在没有明确要求分析持仓或具体标的前，我不会把这份资金规划升级成买卖建议卡。",
  ].join("\n");
}

function equityAllocation(riskLevel: string | null | undefined, maxDrawdown: number | null): number {
  const normalized = String(riskLevel ?? "").toUpperCase();
  const base = normalized === "R1" || normalized === "CONSERVATIVE"
    ? 15
    : normalized === "R2"
      ? 25
      : normalized === "R4"
        ? 55
        : normalized === "R5" || normalized === "AGGRESSIVE"
          ? 65
          : 40;
  if (maxDrawdown === null) return base;
  const cap = maxDrawdown <= 0.1 ? 25 : maxDrawdown <= 0.2 ? 45 : maxDrawdown <= 0.3 ? 60 : 75;
  return Math.min(base, cap);
}

function extractPlannedInvestment(messages: string[]): number | null {
  const context = messages.join("\n");
  const match = context.match(/(?:拿(?:出)?|投入|投资|配置|可用于|准备用|计划用)\s*(?:人民币)?\s*(\d+(?:\.\d+)?)\s*(万元|万|元|w)/iu);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return /万|w/iu.test(match[2]) ? value * 10_000 : value;
}

function positiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function money(value: number): string {
  return `${Math.round(value).toLocaleString("zh-CN")} 元`;
}

function parsePreferences(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function chatCompletionsEndpoint(raw: string): string {
  const url = new URL(raw);
  const path = url.pathname.replace(/\/+$/u, "");
  url.pathname = path.endsWith("/chat/completions") ? path : `${path || "/v1"}/chat/completions`;
  return url.toString();
}
