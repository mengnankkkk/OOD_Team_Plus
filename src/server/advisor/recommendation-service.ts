import { AdvisorError } from "@/server/advisor/http";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import type { AdvisorStore } from "@/server/advisor/store";
import {
  portfolioConcentration,
  portfolioStressLoss,
  simulatePortfolio,
  summarizePortfolio,
} from "@/server/advisor/portfolio-simulation";

export class RecommendationService {
  constructor(private readonly store: AdvisorStore) {}

  get(recommendationId: string) {
    const recommendation = this.store.getRecommendation(recommendationId);
    if (!recommendation) throw new AdvisorError("RESOURCE_NOT_FOUND", "建议不存在。", 404);
    return recommendation;
  }

  list(filters: { action?: string; status?: string } = {}) {
    return this.store.listRecommendations(filters);
  }

  simulate(recommendationId: string, input: Record<string, unknown>) {
    const recommendation = this.get(recommendationId);
    const snapshot = recommendation.portfolioSnapshotId
      ? this.store.analysis.getPortfolioSnapshot(recommendation.portfolioSnapshotId)
      : null;
    const before = (snapshot?.details ?? {}) as Record<string, unknown>;
    const after = simulatePortfolio(before, recommendation, input);
    const beforeConcentration = portfolioConcentration(before);
    const afterConcentration = (after.concentration ?? {}) as Record<string, unknown>;
    const stressLossBefore = portfolioStressLoss(before);
    const stressLossAfter = portfolioStressLoss(after);
    const concentrationComparison = compareConcentrationRisk(beforeConcentration, afterConcentration);
    const riskLimits = before.riskLimits && typeof before.riskLimits === "object"
      ? before.riskLimits as Record<string, unknown>
      : {};
    const maxAcceptableDrawdown = finiteNumber(riskLimits.maxAcceptableDrawdown);
    const estimatedDrawdown = Number(after.currentDrawdown ?? 0);
    return this.store.decisions.saveSimulation(DEMO_USER_ID, recommendationId, {
      scenario: input.scenario ?? "PROPOSED",
      before: summarizePortfolio(before),
      after: summarizePortfolio(after),
      allocationBefore: before.allocation ?? [],
      allocationAfter: after.allocation ?? [],
      stressLossBefore,
      stressLossAfter,
      reallocation: after.reallocation,
      riskChecks: {
        concentrationImproved: concentrationComparison.improved,
        concentrationStatus: concentrationComparison.status,
        concentrationDelta: concentrationComparison.deltas.largestPositionWeight,
        concentrationDeltas: concentrationComparison.deltas,
        stressLossImproved: stressLossAfter > stressLossBefore,
        drawdownWithinProfile: maxAcceptableDrawdown == null
          ? null
          : estimatedDrawdown >= -maxAcceptableDrawdown,
        maxAcceptableDrawdown,
      },
      note: "仅为组合影响模拟，不会创建订单；回撤变化为压力估算，不代表未来实际回撤。",
    });
  }

  recordDecision(recommendationId: string, input: Record<string, unknown>) {
    const recommendation = this.get(recommendationId);
    if (input.action === "SIMULATED_ACCEPT" && recommendation.status === "BLOCKED") {
      throw new AdvisorError("DECISION_CONFLICT", "被阻断的建议不能模拟采纳，请先追问或拒绝。", 409);
    }
    return this.store.decisions.saveDecision(DEMO_USER_ID, {
      ...input,
      recommendationId,
    });
  }
}

type ConcentrationMetrics = {
  largestPositionWeight?: unknown;
  largestSectorWeight?: unknown;
  topThreeWeight?: unknown;
};

export function compareConcentrationRisk(
  before: ConcentrationMetrics,
  after: ConcentrationMetrics,
) {
  const keys = ["largestPositionWeight", "largestSectorWeight", "topThreeWeight"] as const;
  const deltas = Object.fromEntries(keys.map((key) => [
    key,
    Number(after[key] ?? 0) - Number(before[key] ?? 0),
  ])) as Record<(typeof keys)[number], number>;
  const epsilon = 1e-9;
  const values = Object.values(deltas);
  const hasImprovement = values.some((delta) => delta < -epsilon);
  const hasDeterioration = values.some((delta) => delta > epsilon);
  const status = hasImprovement && hasDeterioration
    ? "MIXED"
    : hasImprovement
      ? "IMPROVED"
      : hasDeterioration
        ? "WORSE"
        : "UNCHANGED";
  return {
    improved: status === "IMPROVED",
    status,
    deltas,
  };
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
