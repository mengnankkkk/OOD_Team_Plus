import { describe, expect, it } from "vitest";

import { RecommendationService } from "@/server/advisor/recommendation-service";
import { compareConcentrationRisk } from "@/server/advisor/recommendation-service";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { AdvisorStore } from "@/server/advisor/store";

describe("portfolio simulation regressions", () => {
  it("does not call a mixed concentration result an improvement", () => {
    expect(compareConcentrationRisk(
      {
        largestPositionWeight: 0.4,
        largestSectorWeight: 0.6,
        topThreeWeight: 0.8,
      },
      {
        largestPositionWeight: 0.35,
        largestSectorWeight: 0.65,
        topThreeWeight: 0.82,
      },
    )).toMatchObject({
      status: "MIXED",
      improved: false,
    });
  });

  it("reallocates a percentage of the sold holding instead of a fixed portfolio weight", () => {
    const store = new AdvisorStore();
    const snapshot = store.analysis.savePortfolioSnapshot({
      userId: DEMO_USER_ID,
      reason: "test",
      asOf: "2026-07-24T00:00:00.000Z",
      totalValueMinor: 100_000,
      cashValueMinor: 20_000,
      investedValueMinor: 80_000,
      totalCostMinor: 80_000,
      unrealizedPnlMinor: 0,
      currentDrawdown: -0.02,
      dataQuality: "partial",
      details: {
        allocation: [
          { category: "STOCK", weight: 0.6 },
          { category: "GOLD_ETF", weight: 0.2 },
          { category: "CASH", weight: 0.2 },
        ],
        holdings: [
          {
            asset: { instrumentId: "instrument_000001_sz", assetType: "STOCK", sectorName: "银行" },
            position: { portfolioWeight: 0.6 },
          },
          {
            asset: { instrumentId: "instrument_518880_sh", assetType: "GOLD_ETF", sectorName: "黄金" },
            position: { portfolioWeight: 0.2 },
          },
        ],
        concentration: { largestPositionWeight: 0.6, largestSectorWeight: 0.6, topThreeWeight: 0.8 },
        currentDrawdown: -0.02,
      },
    });
    const recommendation = store.saveRecommendation({
      analysisId: "analysis_reallocate_regression",
      conversationId: "conversation_reallocate_regression",
      portfolioSnapshotId: snapshot.id,
      action: "SCALE_OUT",
      status: "DEGRADED",
      summary: "建议分批减仓。",
      suitability: "MEDIUM",
      confidence: "LOW",
      rationales: [],
      counterEvidence: [],
      risks: [],
      validUntil: "2026-07-31T00:00:00.000Z",
      sourceSummary: "test",
      sellDownRatio: "20%-40%",
    });

    const simulation = new RecommendationService(store).simulate(recommendation.id, {
      scenario: "SCALE_OUT",
      customAdjustment: {
        sellRatio: 0.25,
        reallocateTo: [{ category: "CASH", ratio: 0.5 }, { category: "GOLD_ETF", ratio: 0.5 }],
      },
    });
    const after = simulation.allocationAfter as Array<Record<string, unknown>>;

    expect(after.find((item) => item.category === "STOCK")?.weight).toBeCloseTo(0.45, 5);
    expect(after.find((item) => item.category === "CASH")?.weight).toBeCloseTo(0.275, 5);
    expect(after.find((item) => item.category === "GOLD_ETF")?.weight).toBeCloseTo(0.275, 5);
    expect(simulation.reallocation).toMatchObject({
      fromCategory: "STOCK",
      releasedWeight: 0.15,
      destinationCategory: "CASH",
    });
    expect((simulation.reallocation as Record<string, unknown>).destinations).toEqual([
      { category: "CASH", weight: 0.075 },
      { category: "GOLD_ETF", weight: 0.075 },
    ]);
  });

  it("does not treat cash as the largest risky position", () => {
    const store = new AdvisorStore();
    const snapshot = store.analysis.savePortfolioSnapshot({
      userId: DEMO_USER_ID,
      reason: "test",
      asOf: "2026-07-24T00:00:00.000Z",
      totalValueMinor: 100_000,
      cashValueMinor: 70_000,
      investedValueMinor: 30_000,
      totalCostMinor: 30_000,
      unrealizedPnlMinor: 0,
      currentDrawdown: -0.02,
      dataQuality: "partial",
      details: {
        allocation: [
          { category: "STOCK", weight: 0.2 },
          { category: "GOLD_ETF", weight: 0.1 },
          { category: "CASH", weight: 0.7 },
        ],
        holdings: [
          {
            asset: { instrumentId: "instrument_000001_sz", assetType: "STOCK", sectorName: "银行" },
            position: { portfolioWeight: 0.2 },
          },
          {
            asset: { instrumentId: "instrument_518880_sh", assetType: "GOLD_ETF", sectorName: "黄金" },
            position: { portfolioWeight: 0.1 },
          },
        ],
        currentDrawdown: -0.02,
      },
    });
    const recommendation = store.saveRecommendation({
      analysisId: "analysis_cash_concentration_regression",
      conversationId: "conversation_cash_concentration_regression",
      portfolioSnapshotId: snapshot.id,
      action: "WATCH",
      status: "DEGRADED",
      summary: "继续观察。",
      suitability: "MEDIUM",
      confidence: "LOW",
      rationales: [],
      counterEvidence: [],
      risks: [],
      validUntil: "2026-07-31T00:00:00.000Z",
      sourceSummary: "test",
    });

    const simulation = new RecommendationService(store).simulate(recommendation.id, { scenario: "WATCH" });

    expect((simulation.after as Record<string, unknown>).concentration).toMatchObject({
      largestPositionWeight: 0.2,
      topThreeWeight: expect.closeTo(0.3, 5),
    });
    expect(simulation.riskChecks).toMatchObject({
      concentrationStatus: "UNCHANGED",
      concentrationImproved: false,
    });
  });
});
