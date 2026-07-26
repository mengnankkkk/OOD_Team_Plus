import { Agent } from "@mastra/core/agent";
import Decimal from "decimal.js";

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
import { completeScenarioEvidence } from "./scenario-evidence";
import { mergeBranchScenarioPartial, normalizeScenarioStrategy, parseBranchScenarioModelPlan } from "./scenario-model-plan";

export type BranchScenarioAgentResult = {
  provider: BranchScenarioPlan["provider"];
  plan: BranchScenarioPlan;
  delegatedAgents: string[];
  fallbackReason?: "MODEL_NOT_CONFIGURED" | "MODEL_OUTPUT_INVALID";
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
    return { provider: "DETERMINISTIC_FALLBACK", plan, delegatedAgents: ["DETERMINISTIC_FALLBACK"], fallbackReason: "MODEL_NOT_CONFIGURED" };
  }

  try {
    callbacks.onAgentStarted?.("PROFILE_CONTEXT", "检查用户风险、期限和资金约束");
    callbacks.onAgentStarted?.("DATA_RESEARCH", "整理当前分支可用的事实和数据新鲜度");
    callbacks.onAgentStarted?.("PORTFOLIO_RISK", "评估集中度、压力回撤和现金缓冲");
    callbacks.onAgentStarted?.("SCENARIO_PLANNER", "提出互斥的 A/B/C 分支方案");
    callbacks.onAgentStarted?.("COMPLIANCE_REVIEWER", "检查模拟边界、证据和失效条件");
    const agent = createBranchScenarioAgent();
    const modelPlan = await generateModelPlan(agent, buildPrompt(input));
    const plan = BranchScenarioPlanSchema.parse({
      ...modelPlan,
      provider: "CHIEF_ADVISOR",
      delegatedAgents: Array.isArray(modelPlan.delegatedAgents) ? modelPlan.delegatedAgents : [],
      options: (modelPlan.options ?? []).map((option, index) => {
        const trades = normalizeModelTrades(option.trades);
        const strategy = normalizeScenarioStrategy(option.strategy, trades);
        return {
          ...option,
          strategy,
          label: scenarioLabel(strategy, index),
          trades,
          ...completeScenarioEvidence({ ...option, strategy, trades }, input),
        };
      }),
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
    return { provider: "DETERMINISTIC_FALLBACK", plan, delegatedAgents: ["DETERMINISTIC_FALLBACK"], fallbackReason: "MODEL_OUTPUT_INVALID" };
  }
}

async function generateModelPlan(agent: Agent, prompt: string): Promise<BranchScenarioModelPlan> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const stream = await agent.stream(`${prompt}\n${attempt === 0 ? "请输出紧凑的 options 数组。" : "上一轮输出不完整。请补齐 options、description、strategy、trades 以及基于 research 的依据、反方证据、风险和假设字段。"}`, {
        maxSteps: 10,
        modelSettings: { maxOutputTokens: 4_000, temperature: 0.1 },
        structuredOutput: {
          schema: BranchScenarioModelPlanSchema,
          instructions: "只输出 JSON。每个方案必须输出 description、strategy、trades、rationale、counterEvidence、risks、assumptions、invalidationConditions；这些文案必须引用输入 research 中的标的、数值、日期或明确的数据缺口，禁止使用固定模板。不要输出 provider 或 label；交易中禁止输出 price，所有价格由服务端冻结。",
        },
      });
      let latestPartial: Partial<BranchScenarioModelPlan> = {};
      for await (const partial of stream.objectStream) {
        if (partial && typeof partial === "object") latestPartial = mergeBranchScenarioPartial(latestPartial, partial);
      }
      const streamedObject = await stream.object.catch(() => undefined);
      return parseBranchScenarioModelPlan(streamedObject, latestPartial);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
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
      "输出 1 到 3 个互斥的候选方案，每个方案都必须有 description、strategy、trades、rationale、counterEvidence、risks、assumptions、invalidationConditions。",
      "主要依据、反方证据和主要风险必须引用 research 中的具体标的、数值、日期或明确的数据缺口，禁止输出“基于当前分支上下文生成的模型候选”“市场变化可能使当前方案失效”等模板句。",
      "只输出交易意图 instrumentId/action/quantity，禁止输出 price；服务端会使用冻结价格。",
      "不允许修改真实 holdings，不允许声称真实收益或未来概率。",
    ].join("\n"),
  });
}

type ScenarioOptionDraft = Omit<BranchScenarioOption, "rationale" | "counterEvidence" | "risks" | "assumptions" | "invalidationConditions">
  & Partial<Pick<BranchScenarioOption, "rationale" | "counterEvidence" | "risks" | "assumptions" | "invalidationConditions">>;

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
  const options = [
    option("A · 保持观察", "不产生模拟交易，保留当前分支作为对照组", "HOLD", []),
    option("B · 风险预算再平衡", "从最大持仓释放一部分风险预算，优先承接到已有允许的分散标的", "BALANCED", rebalanceTrades),
    option("C · 压力约束降险", "只执行卖出并把释放资金留在现金，优先提高缓冲", "DEFENSIVE", largest && sellQuantity ? [{
      instrumentId: String(largest.instrument_id),
      action: "SELL",
      quantity: sellQuantity,
    }] : []),
  ].map((draft) => ({ ...draft, ...completeScenarioEvidence(draft, input) }));
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
): ScenarioOptionDraft {
  return {
    label,
    description,
    strategy,
    trades,
    targetAllocations: [],
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
    "输出必须是紧凑的结构化 JSON，不要 Markdown，不要隐藏思维链。输出 1 到 3 个 options，每个必须包含 description、strategy、trades、rationale、counterEvidence、risks、assumptions、invalidationConditions；文案必须引用 research 的具体事实或数据缺口。provider 和 label 由服务端生成，禁止输出这两个字段。",
    "模型只负责场景理解和交易意图，禁止填写 price；不得创造不在 instruments 中的标的。",
    JSON.stringify(input),
  ].join("\n");
}

function scenarioLabel(strategy: BranchScenarioOption["strategy"], index: number): string {
  const title = strategy === "HOLD" ? "保持观察" : strategy === "BALANCED" ? "风险预算再平衡" : strategy === "DEFENSIVE" ? "压力约束降险" : "增长情景";
  return `${String.fromCharCode(65 + index)} · ${title}`;
}

export function normalizeModelTrades(
  trades: Array<{
    instrumentId?: string | null;
    action?: string | null;
    quantity?: string | number | null;
  }> | null | undefined,
): Array<{ instrumentId: string; action: "BUY" | "SELL"; quantity: string }> {
  const grouped = new Map<string, { instrumentId: string; action: "BUY" | "SELL"; quantity: Decimal }>();
  for (const trade of trades ?? []) {
    const instrumentId = String(trade.instrumentId ?? "").trim();
    const action = String(trade.action ?? "").toUpperCase();
    if (!instrumentId || !["BUY", "SELL"].includes(action)) continue;
    const quantity = new Decimal(String(trade.quantity ?? ""));
    if (!quantity.isFinite() || !quantity.gt(0)) continue;
    const key = `${instrumentId}:${action}`;
    const current = grouped.get(key);
    grouped.set(key, current
      ? { ...current, quantity: current.quantity.plus(quantity) }
      : { instrumentId, action: action as "BUY" | "SELL", quantity });
  }
  return [...grouped.values()].map((trade) => ({
    instrumentId: trade.instrumentId,
    action: trade.action,
    quantity: trade.quantity.toDecimalPlaces(12).toFixed().replace(/\.0+$/u, "").replace(/(\.\d*?)0+$/u, "$1"),
  }));
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 180) : "MODEL_OUTPUT_INVALID";
}
