import Decimal from "decimal.js";

import {
  BranchScenarioModelPlanSchema,
  type BranchScenarioModelPlan,
  type BranchScenarioOption,
} from "./scenario-contracts";

const meaningfulOptionKeys = [
  "description", "summary", "name", "title", "strategy", "mode", "trades",
  "transactions", "tradeIntents", "targetAllocations", "target_allocations", "rationale",
];
const bareOptionKeys = [
  "description", "name", "title", "strategy", "mode", "trades", "transactions",
  "tradeIntents", "targetAllocations", "target_allocations", "rationale", "counterEvidence",
  "risks", "assumptions", "invalidationConditions",
];

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
      return BranchScenarioModelPlanSchema.parse(normalizeModelPlan(stripModelOwnedFields(candidate))) as unknown as BranchScenarioModelPlan;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("MODEL_OUTPUT_INVALID");
}

function stripModelOwnedFields(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const result = { ...(value as Record<string, unknown>) };
  delete result.provider;
  delete result.label;
  return result;
}

function normalizeModelPlan(value: unknown): unknown {
  const unwrapped = unwrapModelEnvelope(value);
  if (!isRecord(unwrapped)) return unwrapped;
  const rawOptions = optionCollection(unwrapped);
  const options = rawOptions
    .map(normalizeModelOption)
    .filter((option): option is Record<string, unknown> => option !== null);
  const modelSummary = normalizeText(unwrapped.modelSummary ?? unwrapped.summary);
  const normalized: Record<string, unknown> = {
    options,
    delegatedAgents: normalizeDelegatedAgents(unwrapped.delegatedAgents ?? unwrapped.agents),
  };
  if (modelSummary) normalized.modelSummary = modelSummary.slice(0, 1000);
  return normalized;
}

function normalizeModelOption(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !hasMeaningfulOption(value)) return null;
  const trades = asCollection(value.trades ?? value.transactions ?? value.tradeIntents)
    .map(normalizeModelTrade)
    .filter((trade): trade is Record<string, unknown> => trade !== null);
  const targetAllocations = asCollection(value.targetAllocations ?? value.target_allocations)
    .map(normalizeModelAllocation)
    .filter((allocation): allocation is Record<string, unknown> => allocation !== null);
  return {
    description: normalizeText(value.description ?? value.summary ?? value.name ?? value.title) ?? "模型候选方案",
    strategy: normalizeScenarioStrategy(value.strategy ?? value.mode, trades),
    trades,
    targetAllocations,
    rationale: normalizeList(value.rationale, 3),
    counterEvidence: normalizeList(value.counterEvidence, 3),
    risks: normalizeList(value.risks, 3),
    assumptions: normalizeList(value.assumptions, 8),
    invalidationConditions: normalizeList(value.invalidationConditions, 6),
  };
}

function normalizeList(value: unknown, limit: number): string[] {
  const rawItems = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  const items = rawItems.map((item) => {
    if (typeof item === "string") return item.trim();
    if (!isRecord(item)) return "";
    return normalizeText(item.text ?? item.reason ?? item.message ?? item.value) ?? "";
  }).filter((item) => item.length > 0).slice(0, limit);
  return items;
}

function normalizeModelTrade(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const nestedInstrument = isRecord(value.instrument) ? value.instrument : undefined;
  const instrumentId = normalizeText(
    value.instrumentId
      ?? value.instrument_id
      ?? value.symbol
      ?? value.ticker
      ?? value.asset
      ?? nestedInstrument?.id
      ?? nestedInstrument?.symbol
      ?? value.instrument,
  );
  const action = normalizeTradeAction(value.action ?? value.side ?? value.direction ?? value.tradeAction);
  const quantity = normalizeDecimalValue(value.quantity ?? value.qty ?? value.amount ?? value.shares ?? value.units);
  if (!instrumentId || !action || !quantity || !isPositiveDecimal(quantity)) return null;
  return { instrumentId, action, quantity };
}

function normalizeModelAllocation(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const instrumentId = normalizeText(value.instrumentId ?? value.instrument_id ?? value.symbol ?? value.ticker);
  const weight = normalizeDecimalValue(value.weight ?? value.targetWeight ?? value.percentage);
  if (!instrumentId || !weight) return null;
  return { instrumentId, weight };
}

function normalizeDecimalValue(value: unknown): string | undefined {
  const raw = typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : typeof value === "string"
      ? value.trim().replaceAll(",", "")
      : "";
  if (!raw) return undefined;
  try {
    const amount = raw.endsWith("%")
      ? new Decimal(raw.slice(0, -1)).div(100)
      : new Decimal(raw);
    if (!amount.isFinite() || amount.isNegative()) return undefined;
    return trimDecimal(amount.toFixed(12));
  } catch {
    return undefined;
  }
}

function isPositiveDecimal(value: string): boolean {
  try {
    return new Decimal(value).gt(0);
  } catch {
    return false;
  }
}

function trimDecimal(value: string): string {
  return value.replace(/\.0+$/u, "").replace(/(\.\d*?)0+$/u, "$1");
}

function normalizeTradeAction(value: unknown): "BUY" | "SELL" | null {
  const action = normalizeText(value)?.toUpperCase().replace(/[\s_-]+/gu, "_");
  if (!action) return null;
  if (["BUY", "PURCHASE", "ADD", "买入", "增持"].includes(action)) return "BUY";
  if (["SELL", "LIQUIDATE", "REDUCE", "卖出", "减持"].includes(action)) return "SELL";
  return null;
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function normalizeDelegatedAgents(value: unknown): string[] {
  const raw = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  return raw
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, 12);
}

function optionCollection(plan: Record<string, unknown>): unknown[] {
  for (const key of ["options", "candidates", "scenarios", "plans", "variants", "items", "option", "candidate"]) {
    const items = asCollection(plan[key]);
    if (items.some((item) => isRecord(item) && hasMeaningfulOption(item))) return items;
  }
  if (hasBareOptionShape(plan)) return [plan];
  return [];
}

function asCollection(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return isRecord(value) ? [value] : [];
}

function hasMeaningfulOption(value: Record<string, unknown>): boolean {
  return hasAnyOptionValue(value, meaningfulOptionKeys);
}

function hasBareOptionShape(value: Record<string, unknown>): boolean {
  return hasAnyOptionValue(value, bareOptionKeys);
}

function hasAnyOptionValue(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => {
    const item = value[key];
    return Array.isArray(item) ? item.length > 0 : normalizeText(item) !== undefined;
  });
}

function unwrapModelEnvelope(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!isRecord(current) || optionCollection(current).length > 0) return current;
    const nested = current.result ?? current.data ?? current.output ?? current.plan ?? current.payload;
    if (!isRecord(nested)) return current;
    current = nested;
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
