import {
  BranchScenarioModelPlanSchema,
  type BranchScenarioModelPlan,
  type BranchScenarioOption,
} from "./scenario-contracts";

export function mergeBranchScenarioPartial(
  previous: Partial<BranchScenarioModelPlan>,
  incoming: unknown,
): Partial<BranchScenarioModelPlan> {
  return deepMergePartial(previous, incoming) as Partial<BranchScenarioModelPlan>;
}

export function parseBranchScenarioModelPlan(
  completed: unknown,
  partial: Partial<BranchScenarioModelPlan>,
): BranchScenarioModelPlan {
  let lastError: unknown;
  for (const candidate of [completed, partial, mergeDefined(partial, completed)]) {
    try {
      return BranchScenarioModelPlanSchema.parse(normalizeModelPlan(stripModelOwnedFields(candidate)));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function stripModelOwnedFields(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const result = { ...(value as Record<string, unknown>) };
  delete result.provider;
  delete result.label;
  return result;
}

function normalizeModelPlan(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const plan = value as Record<string, unknown>;
  if (!Array.isArray(plan.options)) return value;
  return { ...plan, options: plan.options.map(normalizeModelOption) };
}

function normalizeModelOption(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const option = value as Record<string, unknown>;
  const trades = Array.isArray(option.trades) ? option.trades.map(normalizeModelTrade) : [];
  const targetAllocations = Array.isArray(option.targetAllocations)
    ? option.targetAllocations.map(normalizeModelAllocation)
    : [];
  return {
    ...option,
    strategy: normalizeScenarioStrategy(option.strategy, trades),
    trades,
    targetAllocations,
    rationale: normalizeList(option.rationale, "基于当前分支上下文生成的模型候选"),
    counterEvidence: normalizeList(option.counterEvidence, "市场变化可能使当前方案失效"),
    risks: normalizeList(option.risks, "候选结果仅用于模拟，不代表未来收益"),
    assumptions: normalizeList(option.assumptions, "价格由服务端冻结并用于比较"),
    invalidationConditions: normalizeList(option.invalidationConditions, "风险画像、资金用途或市场数据发生变化"),
  };
}

function normalizeList(value: unknown, fallback: string): string[] {
  if (!Array.isArray(value)) return [fallback];
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 8);
  return items.length ? items : [fallback];
}

function normalizeModelTrade(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const trade = value as Record<string, unknown>;
  return { ...trade, quantity: normalizeDecimalValue(trade.quantity) };
}

function normalizeModelAllocation(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const allocation = value as Record<string, unknown>;
  return { ...allocation, weight: normalizeDecimalValue(allocation.weight) };
}

function normalizeDecimalValue(value: unknown): unknown {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" ? value.trim() : value;
}

function mergeDefined(partial: Partial<BranchScenarioModelPlan>, completed: unknown): Record<string, unknown> {
  if (!completed || typeof completed !== "object" || Array.isArray(completed)) return { ...partial };
  const definedEntries = Object.entries(completed as Record<string, unknown>).filter(([, value]) => value !== undefined);
  return { ...partial, ...Object.fromEntries(definedEntries) };
}

function deepMergePartial(previous: unknown, incoming: unknown): unknown {
  if (incoming === undefined) return previous;
  if (Array.isArray(incoming)) {
    const priorItems = Array.isArray(previous) ? previous : [];
    const length = Math.max(priorItems.length, incoming.length);
    return Array.from({ length }, (_, index) => deepMergePartial(priorItems[index], incoming[index]));
  }
  if (incoming && typeof incoming === "object") {
    const priorRecord = previous && typeof previous === "object" && !Array.isArray(previous)
      ? previous as Record<string, unknown>
      : {};
    const incomingRecord = incoming as Record<string, unknown>;
    return Object.fromEntries([...new Set([...Object.keys(priorRecord), ...Object.keys(incomingRecord)])]
      .map((key) => [key, deepMergePartial(priorRecord[key], incomingRecord[key])]));
  }
  return incoming;
}

export function normalizeScenarioStrategy(value: unknown, trades: unknown[]): BranchScenarioOption["strategy"] {
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
  return "HOLD";
}
