import type { RecommendationCard } from "@/server/advisor/types";

export type WeightedAllocation = Record<string, unknown> & { category: string; weight: number };
export type WeightBucket = {
  key: Record<string, unknown> | null;
  category: string;
  weight: number;
};
export type ReallocationDestination = { category: string; weight: number };

export function targetCategoryFor(recommendation: RecommendationCard, allocation: Array<Record<string, unknown>>) {
  if (recommendation.action === "SCALE_OUT" || recommendation.action === "EXIT") {
    const target = [...allocation]
      .filter((item) => item.category !== "CASH")
      .sort((a, b) => Number(b.weight ?? 0) - Number(a.weight ?? 0))[0]?.category;
    return target == null ? "STOCK" : String(target);
  }
  if (recommendation.summary.includes("黄金")) return "GOLD_ETF";
  return "STOCK";
}

export function selectTargetHolding(
  recommendation: RecommendationCard,
  holdings: Array<Record<string, unknown>>,
  targetCategory: string,
) {
  const byInstrument = recommendation.instrumentId
    ? holdings.find((holding) => (holding.asset as Record<string, unknown> | undefined)?.instrumentId === recommendation.instrumentId)
    : undefined;
  if (byInstrument) return byInstrument;
  return holdings
    .filter((holding) => (holding.asset as Record<string, unknown> | undefined)?.assetType === targetCategory)
    .sort((a, b) => Number((b.position as Record<string, unknown> | undefined)?.portfolioWeight ?? 0) - Number((a.position as Record<string, unknown> | undefined)?.portfolioWeight ?? 0))[0];
}

export function resolveReleasedWeight(
  currentWeight: number,
  recommendation: RecommendationCard,
  customAdjustment: Record<string, unknown>,
) {
  if (typeof customAdjustment.sellRatio === "number" && Number.isFinite(customAdjustment.sellRatio)) {
    return currentWeight * clamp(customAdjustment.sellRatio, 0, 1);
  }
  if (typeof customAdjustment.weightShift === "number" && customAdjustment.weightShift < 0) {
    return Math.min(currentWeight, Math.abs(customAdjustment.weightShift));
  }
  if (recommendation.action === "EXIT") return currentWeight;
  const ratio = parseRatioRange(recommendation.sellDownRatio);
  return ratio == null ? Math.min(currentWeight, 0.1) : currentWeight * ratio;
}

export function resolveDestinations(
  releasedWeight: number,
  recommendation: RecommendationCard,
  customAdjustment: Record<string, unknown>,
  destinationCategory?: string,
) {
  const raw = customAdjustment.reallocateTo;
  if (Array.isArray(raw)) {
    const requested = raw
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item) => ({
        category: String(item.category ?? "").trim(),
        ratio: Number(item.ratio ?? item.weight ?? 0),
      }))
      .filter((item) => item.category && Number.isFinite(item.ratio) && item.ratio > 0);
    const total = requested.reduce((sum, item) => sum + item.ratio, 0);
    if (total > 0) {
      return requested.map((item) => ({
        category: item.category,
        weight: releasedWeight * item.ratio / total,
      }));
    }
  }
  return [{
    category: destinationCategory ?? "CASH",
    weight: releasedWeight,
  }];
}

export function holdingCategoryWeights(
  holdings: Array<Record<string, unknown>>,
  allocation: Array<Record<string, unknown>>,
) {
  const categoryWeights = new Map<string, number>();
  for (const holding of holdings) {
    const asset = holding.asset as Record<string, unknown> | undefined;
    const category = String(asset?.assetType ?? "UNKNOWN");
    const weight = Number((holding.position as Record<string, unknown> | undefined)?.portfolioWeight ?? 0);
    categoryWeights.set(category, (categoryWeights.get(category) ?? 0) + Math.max(0, weight));
  }
  const cashWeight = Number(allocation.find((item) => item.category === "CASH")?.weight ?? 0);
  if (cashWeight > 0) categoryWeights.set("CASH", cashWeight);
  return categoryWeights;
}

export function replaceAllocationWeights(
  weights: WeightedAllocation[],
  categoryWeights: Map<string, number>,
) {
  for (const item of weights) item.weight = Math.max(0, categoryWeights.get(item.category) ?? 0);
  for (const [category, weight] of categoryWeights) {
    if (!weights.some((item) => item.category === category)) weights.push({ category, weight });
  }
}

export function shiftWeights<T extends { weight: number }>(items: T[], target: T, shift: number) {
  const oldTarget = target.weight;
  target.weight = clamp(oldTarget + shift, 0, 1);
  const actualShift = target.weight - oldTarget;
  const others = items.filter((item) => item !== target);
  const othersTotal = others.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (othersTotal > 0 && actualShift !== 0) {
    for (const item of others) item.weight = clamp(item.weight - actualShift * item.weight / othersTotal, 0, 1);
  }
  normalizeWeights(items);
}

export function normalizeWeights<T extends { weight: number }>(items: T[]) {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (total > 0) for (const item of items) item.weight = Math.max(0, item.weight) / total;
}

export function calculateConcentration(
  allocation: Array<Record<string, unknown>>,
  holdings: Array<Record<string, unknown>>,
  previous: Record<string, unknown> | undefined,
) {
  if (holdings.length === 0) {
    const weights = allocation
      .filter((item) => item.category !== "CASH")
      .map((item) => Number(item.weight ?? 0))
      .sort((a, b) => b - a);
    return {
      largestPositionWeight: weights[0] ?? 0,
      largestSectorWeight: Math.max(0, ...weights),
      topThreeWeight: weights.slice(0, 3).reduce((sum, value) => sum + value, 0),
    };
  }
  const positionWeights = holdings
    .map((holding) => Number((holding.position as Record<string, unknown> | undefined)?.portfolioWeight ?? 0))
    .filter((weight) => weight > 0)
    .sort((a, b) => b - a);
  const sectorWeights = new Map<string, number>();
  for (const holding of holdings) {
    const asset = holding.asset as Record<string, unknown> | undefined;
    const key = String(asset?.sectorName ?? asset?.assetType ?? "UNKNOWN");
    const weight = Number((holding.position as Record<string, unknown> | undefined)?.portfolioWeight ?? 0);
    sectorWeights.set(key, (sectorWeights.get(key) ?? 0) + weight);
  }
  return {
    largestPositionWeight: positionWeights[0] ?? previous?.largestPositionWeight ?? 0,
    largestSectorWeight: Math.max(0, ...sectorWeights.values()),
    topThreeWeight: positionWeights.slice(0, 3).reduce((sum, value) => sum + value, 0),
  };
}

export function cloneHolding(holding: Record<string, unknown>) {
  return {
    ...holding,
    asset: holding.asset && typeof holding.asset === "object" ? { ...(holding.asset as Record<string, unknown>) } : holding.asset,
    position: holding.position && typeof holding.position === "object" ? { ...(holding.position as Record<string, unknown>) } : holding.position,
  };
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseRatioRange(value: string | undefined) {
  if (!value) return null;
  const numbers = value.match(/[0-9]+(?:\.[0-9]+)?/g)?.map(Number) ?? [];
  if (numbers.length === 0) return null;
  const ratio = numbers.reduce((sum, item) => sum + item, 0) / numbers.length / 100;
  return clamp(ratio, 0, 1);
}
