import { Agent } from "@mastra/core/agent";

import { getDeepSeekModelConfig } from "@/server/extensions/advisor/model-config";

import {
  BranchScenarioContextSchema,
  BranchScenarioModelPlanSchema,
  BranchScenarioPlanSchema,
  type BranchScenarioAgentInput,
  type BranchScenarioModelPlan,
  type BranchScenarioOption,
  type BranchScenarioPlan,
} from "./scenario-contracts";

export type BranchScenarioAgentResult = {
  provider: BranchScenarioPlan["provider"];
  plan: BranchScenarioPlan;
  delegatedAgents: string[];
};

export async function runBranchScenarioAgent(
  rawInput: BranchScenarioAgentInput,
  callbacks: {
    onAgentStarted?: (role: string, label: string) => void;
    onAgentCompleted?: (role: string, summary: string) => void;
  } = {},
): Promise<BranchScenarioAgentResult> {
  const input = BranchScenarioContextSchema.parse(rawInput);
  if (!process.env.DEEPSEEK_API_KEY?.trim()) {
    const plan = deterministicFallback(input);
    callbacks.onAgentCompleted?.("DETERMINISTIC_FALLBACK", "模型未配置，使用可解释的确定性候选方案");
    return { provider: "DETERMINISTIC_FALLBACK", plan, delegatedAgents: ["DETERMINISTIC_FALLBACK"] };
  }

  try {
    callbacks.onAgentStarted?.("PROFILE_CONTEXT", "检查用户风险、期限和资金约束");
    callbacks.onAgentStarted?.("DATA_RESEARCH", "整理当前分支可用的事实和数据新鲜度");
    callbacks.onAgentStarted?.("PORTFOLIO_RISK", "评估集中度、压力回撤和现金缓冲");
    callbacks.onAgentStarted?.("SCENARIO_PLANNER", "提出互斥的 A/B/C 分支方案");
    callbacks.onAgentStarted?.("COMPLIANCE_REVIEWER", "检查模拟边界、证据和失效条件");
    const agent = createBranchScenarioAgent();
    const stream = await agent.stream(buildPrompt(input), {
      maxSteps: 10,
      modelSettings: { maxOutputTokens: 2_400, temperature: 0.1 },
      structuredOutput: {
        schema: BranchScenarioModelPlanSchema,
        instructions: "只输出符合 schema 的 JSON。不要输出 provider 或 label；交易中禁止输出 price 字段，所有价格由服务端冻结。",
      },
    });
    let latestPartial: Partial<BranchScenarioModelPlan> = {};
    for await (const partial of stream.objectStream) {
      if (partial && typeof partial === "object") latestPartial = { ...latestPartial, ...partial };
    }
    const streamedObject = await stream.object.catch(() => undefined);
    const modelPlan = parseModelPlan(streamedObject, latestPartial);
    const plan = BranchScenarioPlanSchema.parse({
      ...modelPlan,
      provider: "CHIEF_ADVISOR",
      options: modelPlan.options.map((option, index) => ({
        ...option,
        label: scenarioLabel(option.strategy, index),
        trades: option.trades.filter((trade) => Number(trade.quantity) > 0),
      })),
    });
    for (const role of ["PROFILE_CONTEXT", "DATA_RESEARCH", "PORTFOLIO_RISK", "SCENARIO_PLANNER", "COMPLIANCE_REVIEWER"]) {
      callbacks.onAgentCompleted?.(role, "已完成分支模拟阶段");
    }
    return {
      provider: "CHIEF_ADVISOR",
      plan,
      delegatedAgents: plan.delegatedAgents.length ? plan.delegatedAgents : ["PROFILE_CONTEXT", "DATA_RESEARCH", "PORTFOLIO_RISK", "SCENARIO_PLANNER", "COMPLIANCE_REVIEWER"],
    };
  } catch (error) {
    callbacks.onAgentCompleted?.("CHIEF_ADVISOR", `模型输出不可用，已降级：${safeMessage(error)}`);
    const plan = deterministicFallback(input);
    return { provider: "DETERMINISTIC_FALLBACK", plan, delegatedAgents: ["DETERMINISTIC_FALLBACK"] };
  }
}

export function createBranchScenarioAgent() {
  const specialist = (id: string, name: string) => new Agent({
    id,
    name,
    description: `${name} 为分支模拟提供简短结构化事实，不输出隐藏推理。`,
    model: getDeepSeekModelConfig(),
    defaultOptions: { maxSteps: 1, modelSettings: { maxOutputTokens: 500, temperature: 0.1 } },
    instructions: [
      "只输出可验证的事实、风险、反方证据和缺失信息。",
      "不能发明价格、收益率、概率或新闻。",
      "所有建议仅用于模拟，不连接券商，不创建真实订单。",
    ].join("\n"),
  });

  return new Agent({
    id: "branch-scenario-chief-advisor",
    name: "Branch Scenario Chief Advisor",
    description: "动态协作生成可校验的资产分支候选方案。",
    model: getDeepSeekModelConfig(),
    defaultOptions: { maxSteps: 10, modelSettings: { maxOutputTokens: 2_400, temperature: 0.1 } },
    agents: {
      profile: specialist("branch-profile-context", "Profile Context"),
      research: specialist("branch-data-research", "Data Research"),
      risk: specialist("branch-portfolio-risk", "Portfolio Risk"),
      scenario: specialist("branch-scenario-planner", "Scenario Planner"),
      compliance: specialist("branch-compliance-reviewer", "Compliance Reviewer"),
    },
    instructions: [
      "你是分支模拟的 Chief Advisor，需要根据用户目标动态协作，而不是机械套用固定工作流。",
      "输出 1 到 5 个互斥的候选方案，通常包含保持、再平衡、降险三类不同路径。",
      "每个方案必须有至少一条主要依据、一条反方证据、一条风险、假设和失效条件。",
      "只输出交易意图 instrumentId/action/quantity，禁止输出 price；服务端会使用冻结价格。",
      "不允许修改真实 holdings，不允许声称真实收益或未来概率。",
    ].join("\n"),
  });
}

function deterministicFallback(input: BranchScenarioAgentInput): BranchScenarioPlan {
  const largest = [...input.holdings]
    .sort((left, right) => Number(right.market_value_decimal ?? 0) - Number(left.market_value_decimal ?? 0))[0];
  const target = input.instruments.find((instrument) => {
    const assetType = String(instrument.asset_type ?? "").toUpperCase();
    return !input.holdings.some((holding) => String(holding.instrument_id) === String(instrument.id))
      && /ETF|FUND|INDEX/u.test(assetType)
      && Number(instrument.tradable ?? 1) === 1;
  });
  const sellQuantity = largest ? positiveHalf(String(largest.quantity_decimal ?? "0")) : null;
  const rebalanceTrades: BranchScenarioOption["trades"] = largest && sellQuantity ? [{
    instrumentId: String(largest.instrument_id),
    action: "SELL" as const,
    quantity: sellQuantity,
  }] : [];
  if (target && sellQuantity) {
    rebalanceTrades.push({
      instrumentId: String(target.id),
      action: "BUY",
      quantity: sellQuantity,
    });
  }
  const options: BranchScenarioOption[] = [
    option("A · 保持观察", "不产生模拟交易，保留当前分支作为对照组", "HOLD", [], [
      `围绕目标“${input.objective}”保留现状作为基准`,
      "不产生交易费用或成交数量变化",
    ], ["如果集中度继续上升，组合压力损失不会自动改善"]),
    option("B · 风险预算再平衡", "从最大持仓释放一部分风险预算，优先承接到已有允许的分散标的", "BALANCED", rebalanceTrades, [
      "先降低最大持仓，避免一次性改变整个组合",
      "使用小额、可回溯的模拟交易观察组合影响",
    ], ["若最大持仓随后上涨，分散化可能短期落后"]),
    option("C · 压力约束降险", "只执行卖出并把释放资金留在现金，优先提高缓冲", "DEFENSIVE", largest && sellQuantity ? [{
      instrumentId: String(largest.instrument_id),
      action: "SELL",
      quantity: sellQuantity,
    }] : [], [
      "现金缓冲能降低权益集中冲击下的组合波动",
      "在信息不足时减少不可逆的买入动作",
    ], ["现金也会带来再投资机会成本，不能保证绝对收益"]),
  ];
  return BranchScenarioPlanSchema.parse({
    provider: "DETERMINISTIC_FALLBACK",
    options,
    delegatedAgents: ["DETERMINISTIC_FALLBACK"],
    modelSummary: "未调用模型；候选方案由服务端规则生成并由确定性模拟引擎校验。",
  });
}

function option(
  label: string,
  description: string,
  strategy: BranchScenarioOption["strategy"],
  trades: BranchScenarioOption["trades"],
  rationale: string[],
  counterEvidence: string[],
): BranchScenarioOption {
  return {
    label,
    description,
    strategy,
    trades,
    targetAllocations: [],
    rationale,
    counterEvidence,
    risks: ["冻结价格仅用于比较，不代表未来成交价", "模拟结果不包含真实滑点和税费差异"],
    assumptions: ["不使用杠杆、卖空或虚构标的", "服务端将剔除模型价格并使用冻结价格", "模拟不会修改真实持仓"],
    invalidationConditions: ["用户风险画像或资金用途发生变化", "标的数据源不可用或价格清单过期"],
  };
}

function positiveHalf(value: string): string | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  const half = number / 2;
  return String(Number(half.toFixed(8)));
}

function buildPrompt(input: BranchScenarioAgentInput): string {
  return [
    "请为资产分支模拟生成候选方案。",
    "输出必须符合结构化 schema，不要 Markdown，不要隐藏思维链。provider 和 label 由服务端生成，禁止输出这两个字段。",
    "模型只负责场景理解和交易意图，禁止填写 price；不得创造不在 instruments 中的标的。",
    JSON.stringify(input),
  ].join("\n");
}

function scenarioLabel(strategy: BranchScenarioOption["strategy"], index: number): string {
  const title = strategy === "HOLD" ? "保持观察" : strategy === "BALANCED" ? "风险预算再平衡" : strategy === "DEFENSIVE" ? "压力约束降险" : "增长情景";
  return `${String.fromCharCode(65 + index)} · ${title}`;
}

function normalizeModelPlan(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const plan = value as Record<string, unknown>;
  if (!Array.isArray(plan.options)) return value;
  return {
    ...plan,
    options: plan.options.map((rawOption) => {
      if (!rawOption || typeof rawOption !== "object" || Array.isArray(rawOption)) return rawOption;
      const option = rawOption as Record<string, unknown>;
      const trades = Array.isArray(option.trades) ? option.trades : [];
      return { ...option, strategy: normalizeStrategy(option.strategy, trades) };
    }),
  };
}

function mergeDefined(partial: Partial<BranchScenarioModelPlan>, completed: unknown): Record<string, unknown> {
  if (!completed || typeof completed !== "object" || Array.isArray(completed)) return { ...partial };
  const definedEntries = Object.entries(completed as Record<string, unknown>).filter(([, value]) => value !== undefined);
  return { ...partial, ...Object.fromEntries(definedEntries) };
}

function parseModelPlan(completed: unknown, partial: Partial<BranchScenarioModelPlan>): BranchScenarioModelPlan {
  let lastError: unknown;
  for (const candidate of [completed, partial, mergeDefined(partial, completed)]) {
    try {
      return BranchScenarioModelPlanSchema.parse(normalizeModelPlan(candidate));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function normalizeStrategy(value: unknown, trades: unknown[]): BranchScenarioOption["strategy"] | unknown {
  const strategy = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/gu, "_");
  if (["HOLD", "WAIT", "WATCH", "NO_CHANGE", "UNCHANGED"].includes(strategy) || /保持|观察|不变/u.test(strategy)) return "HOLD";
  if (["BALANCED", "BALANCE", "REBALANCE", "REBALANCING"].includes(strategy) || /平衡|再配置/u.test(strategy)) return "BALANCED";
  if (["DEFENSIVE", "DEFENSE", "DE_RISK", "RISK_REDUCTION", "REDUCE_RISK", "CASH"].includes(strategy) || /防御|降险|减险/u.test(strategy)) return "DEFENSIVE";
  if (["GROWTH", "GROW", "AGGRESSIVE"].includes(strategy) || /增长|进取/u.test(strategy)) return "GROWTH";

  const actions = trades.flatMap((trade) => {
    if (!trade || typeof trade !== "object" || Array.isArray(trade)) return [];
    const action = String((trade as Record<string, unknown>).action ?? "").toUpperCase();
    return action === "BUY" || action === "SELL" ? [action] : [];
  });
  if (actions.length === 0) return "HOLD";
  if (actions.includes("BUY") && actions.includes("SELL")) return "BALANCED";
  if (actions.every((action) => action === "SELL")) return "DEFENSIVE";
  if (actions.every((action) => action === "BUY")) return "GROWTH";
  return value;
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 180) : "MODEL_OUTPUT_INVALID";
}
