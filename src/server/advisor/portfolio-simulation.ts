import { stressLoss as calculateStressLoss } from "@/server/advisor/analytics";
import type { RecommendationCard } from "@/server/advisor/types";
import {
  calculateConcentration,
  clamp,
  cloneHolding,
  holdingCategoryWeights,
  normalizeWeights,
  replaceAllocationWeights,
  resolveDestinations,
  resolveReleasedWeight,
  selectTargetHolding,
  shiftWeights,
  targetCategoryFor,
  type ReallocationDestination,
  type WeightedAllocation,
  type WeightBucket,
} from "@/server/advisor/portfolio-simulation-helpers";

export function simulatePortfolio(
  details: Record<string, unknown>,
  recommendation: RecommendationCard,
  input: Record<string, unknown>,
) {
  const allocation = Array.isArray(details.allocation) ? details.allocation : [];
  const weights: WeightedAllocation[] = allocation.map((item) => ({
    ...(item as Record<string, unknown>),
    category: String((item as Record<string, unknown>).category ?? "UNKNOWN"),
    weight: Number((item as Record<string, unknown>).weight ?? 0),
  }));
  const holdings = Array.isArray(details.holdings)
    ? details.holdings.map((item) => cloneHolding(item as Record<string, unknown>))
    : [];
  const action = recommendation.action;
  const customAdjustment = input.customAdjustment && typeof input.customAdjustment === "object"
    ? input.customAdjustment as Record<string, unknown>
    : {};
  const isSellAction = action === "SCALE_OUT" || action === "EXIT";
  const shift = customAdjustment.weightShift != null
    ? Number(customAdjustment.weightShift)
    : action === "TRIAL_BUY" || action === "SCALE_IN" ? 0.05 : 0;
  const destinationCategory = typeof customAdjustment.destinationCategory === "string"
    ? customAdjustment.destinationCategory
    : isSellAction ? "CASH" : undefined;
  const targetCategory = targetCategoryFor(recommendation, weights);
  const targetHolding = selectTargetHolding(recommendation, holdings, targetCategory);
  let releasedWeight = 0;
  let destinations: ReallocationDestination[] = [];

  if (targetHolding && isSellAction) {
    const targetPosition = targetHolding.position as Record<string, unknown>;
    const oldWeight = Math.max(0, Number(targetPosition.portfolioWeight ?? 0));
    releasedWeight = resolveReleasedWeight(oldWeight, recommendation, customAdjustment);
    targetPosition.portfolioWeight = oldWeight - releasedWeight;
    destinations = resolveDestinations(releasedWeight, recommendation, customAdjustment, destinationCategory);
    const categoryWeights = holdingCategoryWeights(holdings, weights);
    for (const destination of destinations) {
      categoryWeights.set(
        destination.category,
        (categoryWeights.get(destination.category) ?? 0) + destination.weight,
      );
    }
    replaceAllocationWeights(weights, categoryWeights);
  } else if (targetHolding) {
    const holdingBuckets: WeightBucket[] = [
      ...holdings.map((holding) => ({
        key: holding,
        category: String((holding.asset as Record<string, unknown> | undefined)?.assetType ?? "UNKNOWN"),
        weight: Number((holding.position as Record<string, unknown> | undefined)?.portfolioWeight ?? 0),
      })),
      {
        key: null,
        category: "CASH",
        weight: Number(weights.find((item) => item.category === "CASH")?.weight ?? 0),
      },
    ];
    const targetBucket = holdingBuckets.find((bucket) => bucket.key === targetHolding);
    if (targetBucket) {
      shiftWeights(holdingBuckets, targetBucket, shift);
      for (const bucket of holdingBuckets) {
        if (!bucket.key) continue;
        (bucket.key.position as Record<string, unknown>).portfolioWeight = bucket.weight;
      }
      replaceAllocationWeights(weights, holdingCategoryWeights(holdings, weights));
    }
  } else {
    let target = weights.find((item) => item.category === targetCategory);
    if (!target && shift > 0) {
      target = { category: targetCategory, weight: 0 };
      weights.push(target);
    }
    if (target && isSellAction) {
      releasedWeight = resolveReleasedWeight(target.weight, recommendation, customAdjustment);
      target.weight = Math.max(0, target.weight - releasedWeight);
      destinations = resolveDestinations(releasedWeight, recommendation, customAdjustment, destinationCategory);
      for (const destination of destinations) {
        const item = weights.find((candidate) => candidate.category === destination.category);
        if (item) item.weight += destination.weight;
        else weights.push({ category: destination.category, weight: destination.weight });
      }
    } else if (target) {
      shiftWeights(weights, target, shift);
    }
  }

  normalizeWeights(weights);
  const concentration = calculateConcentration(
    weights,
    holdings,
    details.concentration as Record<string, unknown> | undefined,
  );
  const effectiveShift = isSellAction ? -releasedWeight : shift;
  return {
    ...details,
    allocation: weights,
    holdings,
    concentration,
    reallocation: {
      fromCategory: targetCategory,
      releasedWeight,
      destinationCategory: destinations[0]?.category ?? destinationCategory ?? null,
      destinations,
    },
    currentDrawdown: effectiveShift === 0
      ? Number(details.currentDrawdown ?? 0)
      : clamp(
          Number(details.currentDrawdown ?? 0) + (effectiveShift > 0
            ? -Math.abs(effectiveShift) * 0.25
            : Math.abs(effectiveShift) * 0.1),
          -1,
          0,
        ),
  };
}

export function summarizePortfolio(details: Record<string, unknown>) {
  return {
    totalMarketValue: details.totalMarketValue ?? null,
    totalUnrealizedPnl: details.totalUnrealizedPnl ?? null,
    currentDrawdown: details.currentDrawdown ?? null,
    concentration: details.concentration ?? null,
  };
}

export function portfolioConcentration(details: Record<string, unknown>) {
  const allocation = Array.isArray(details.allocation)
    ? details.allocation.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    : [];
  const holdings = Array.isArray(details.holdings)
    ? details.holdings.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    : [];
  return calculateConcentration(
    allocation,
    holdings,
    details.concentration as Record<string, unknown> | undefined,
  );
}

export function portfolioStressLoss(details: Record<string, unknown>): number {
  if (Array.isArray(details.allocation)) {
    const categoryWeights = Object.fromEntries(
      details.allocation
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((item) => [String(item.category), Number(item.weight ?? 0)]),
    );
    return calculateStressLoss(categoryWeights);
  }
  const tests = Array.isArray(details.stressTests) ? details.stressTests : [];
  const value = tests[0] && typeof tests[0] === "object"
    ? (tests[0] as Record<string, unknown>).estimatedPortfolioChange
    : 0;
  return Number(value ?? 0);
}
