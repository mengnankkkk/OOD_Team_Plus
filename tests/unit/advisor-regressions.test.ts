import { describe, expect, it } from "vitest";

import { demoResetSchema } from "@/server/advisor/contracts";
import { parseHoldingText } from "@/server/advisor/holding-parser";
import { RecommendationService } from "@/server/advisor/recommendation-service";
import { DEMO_SEED_VERSION, DEMO_USER_ID, seedAdvisorDemo } from "@/server/advisor/seed";
import { AdvisorStore } from "@/server/advisor/store";
import { fixtureMarketSeries, fixtureResearchMetrics } from "@/server/advisor/fixture-market";
import { runWrite } from "@/server/advisor/store-common";

describe("advisor regressions", () => {
  it("confirms a pending holding draft and rejects a second confirmation", () => {
    const store = new AdvisorStore();
    const draft = parseHoldingText(store, {
      userId: DEMO_USER_ID,
      text: "我有黄金ETF，买了10000份，买入价4.26",
    });

    expect(draft.status).toBe("NEEDS_CONFIRMATION");
    const pending = store.holdings.getDraft(DEMO_USER_ID, draft.id);
    expect(pending?.status).toBe("NEEDS_CONFIRMATION");

    const confirmed = store.holdings.confirmDraft(DEMO_USER_ID, draft.id, pending!.candidates);
    expect(confirmed.status).toBe("CONFIRMED");
    expect(store.holdings.getDraft(DEMO_USER_ID, draft.id)?.status).toBe("CONFIRMED");

    expect(() => store.holdings.confirmDraft(DEMO_USER_ID, draft.id, pending!.candidates)).toThrow(
      "PARSE_ALREADY_CONFIRMED",
    );
  });

  it("reports unchanged concentration when a watch simulation does not change allocation", () => {
    const store = new AdvisorStore();
    const snapshot = store.analysis.savePortfolioSnapshot({
      userId: DEMO_USER_ID,
      reason: "test",
      asOf: "2026-07-24T00:00:00.000Z",
      totalValueMinor: 100_000,
      cashValueMinor: 50_000,
      investedValueMinor: 50_000,
      totalCostMinor: 50_000,
      unrealizedPnlMinor: 0,
      currentDrawdown: -0.02,
      dataQuality: "partial",
      details: {
        allocation: [
          { category: "STOCK", weight: 0.5 },
          { category: "CASH", weight: 0.5 },
        ],
        concentration: {
          largestPositionWeight: 0.5,
          largestSectorWeight: 0.5,
          topThreeWeight: 0.5,
        },
        currentDrawdown: -0.02,
        stressTests: [{ estimatedPortfolioChange: -0.1 }],
      },
    });
    const recommendation = store.saveRecommendation({
      analysisId: "analysis_simulation_regression",
      conversationId: "conversation_simulation_regression",
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

    expect(simulation.riskChecks).toMatchObject({
      concentrationImproved: false,
      concentrationStatus: "UNCHANGED",
    });
  });

  it("simulates a scale-out against an invested position instead of cash", () => {
    const store = new AdvisorStore();
    const snapshot = store.analysis.savePortfolioSnapshot({
      userId: DEMO_USER_ID,
      reason: "test",
      asOf: "2026-07-24T00:00:00.000Z",
      totalValueMinor: 100_000,
      cashValueMinor: 60_000,
      investedValueMinor: 40_000,
      totalCostMinor: 40_000,
      unrealizedPnlMinor: 0,
      currentDrawdown: -0.02,
      dataQuality: "partial",
      details: {
        allocation: [
          { category: "STOCK", weight: 0.2 },
          { category: "CASH", weight: 0.6 },
          { category: "GOLD_ETF", weight: 0.2 },
        ],
        holdings: [
          {
            asset: { instrumentId: "instrument_000001_sz", assetType: "STOCK", sectorName: "银行" },
            position: { portfolioWeight: 0.2 },
          },
          {
            asset: { instrumentId: "instrument_518880_sh", assetType: "GOLD_ETF", sectorName: "黄金" },
            position: { portfolioWeight: 0.2 },
          },
        ],
        concentration: { largestPositionWeight: 0.6, largestSectorWeight: 0.6, topThreeWeight: 1 },
        currentDrawdown: -0.02,
      },
    });
    const recommendation = store.saveRecommendation({
      analysisId: "analysis_scale_out_regression",
      conversationId: "conversation_scale_out_regression",
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
    });

    const simulation = new RecommendationService(store).simulate(recommendation.id, { scenario: "SCALE_OUT" });
    const before = simulation.allocationBefore as Array<Record<string, unknown>>;
    const after = simulation.allocationAfter as Array<Record<string, unknown>>;

    expect(after.find((item) => item.category === "STOCK")?.weight).toBeLessThan(
      before.find((item) => item.category === "STOCK")?.weight as number,
    );
    expect(after.find((item) => item.category === "CASH")?.weight).toBeCloseTo(
      (before.find((item) => item.category === "CASH")?.weight as number) + 0.1,
      5,
    );
    expect(after.find((item) => item.category === "GOLD_ETF")?.weight).toBeCloseTo(
      before.find((item) => item.category === "GOLD_ETF")?.weight as number,
      5,
    );
    expect(simulation.stressLossAfter).toBeGreaterThan(simulation.stressLossBefore as number);
    expect((simulation.after as Record<string, unknown>).currentDrawdown).toBeGreaterThan(
      (simulation.before as Record<string, unknown>).currentDrawdown as number,
    );
  });

  it("keeps a sell action when recommendation status is degraded", async () => {
    const store = new AdvisorStore();
    const result = await import("@/server/advisor/runner").then(({ runAdvisorConversation }) =>
      runAdvisorConversation({
        conversationId: "conversation_sell_degraded",
        question: "黄金涨了，我要不要卖出或减仓？",
        store,
        agentRuntime: {
          async run() {
            return {
              decision: {
                action: "SCALE_OUT",
                status: "DEGRADED",
                summary: "建议分批减仓。",
                suitability: "MEDIUM",
                confidence: "MEDIUM",
                rationales: ["组合集中度偏高。"],
                counterEvidence: ["缺少新鲜行情。"],
                risks: ["短期波动。"],
                suggestedAllocationRange: "15%-30%",
                firstEntryAllocation: "不适用",
                addConditions: [],
                referenceRange: "观察区间",
                stopLoss: "逻辑失效",
                takeProfit: "分批止盈",
                horizon: "MEDIUM",
                validUntil: "2026-07-31T00:00:00.000Z",
                executionPace: "分批执行",
                sellDownRatio: "10%-30%",
                triggerReasons: ["仓位偏高"],
                portfolioImpact: "降低集中度",
                alternatives: ["宽基ETF"],
                invalidationConditions: ["画像变化"],
                sourceSummary: "test",
                agentsConsulted: ["recommendation"],
                compliance: { approved: false, decision: "DOWNGRADED", reason: "缺少实时数据" },
              },
              findings: [],
              delegatedAgents: [],
              dataResults: [],
              researchBundles: [],
              rawText: "test",
            };
          },
        },
      }),
    );

    expect(store.getRecommendation(result.recommendationId)).toMatchObject({
      action: "SCALE_OUT",
      status: "DEGRADED",
    });
  });

  it("seeds real symbols only and does not reuse a fixture for an unknown symbol", () => {
    const store = new AdvisorStore();
    const instruments = store.profile.searchInstruments("");

    expect(instruments.every((instrument) => !instrument.symbol.startsWith("DEMO"))).toBe(true);
    expect(store.profile.getInstrument("DEMO001.SZ")).toBeNull();
    expect(store.profile.getInstrument("000001.SZ")?.name).toBe("平安银行");
    expect(store.profile.getInstrument("510300.SH")?.name).toBe("沪深300ETF");
    expect(store.profile.getInstrument("518880.SH")?.name).toBe("黄金ETF");
    expect(store.profile.getInstrument("515000.SH")?.name).toBe("华宝中证科技龙头ETF");
    expect(fixtureMarketSeries("UNKNOWN.SZ")).toEqual([]);
    expect(fixtureResearchMetrics("UNKNOWN.SZ").price).toBeUndefined();
  });

  it("accepts the current real-symbol seed version in the reset contract", () => {
    expect(demoResetSchema.parse({ seedVersion: DEMO_SEED_VERSION })).toEqual({
      seedVersion: DEMO_SEED_VERSION,
    });
  });

  it("removes legacy demo instruments when upgrading an old seed", () => {
    const store = new AdvisorStore();
    const timestamp = "2026-07-24T00:00:00.000Z";
    runWrite(
      store.database,
      `INSERT INTO instruments
       (id, symbol, name, instrument_type, instrument_subtype, market, currency, sector_name,
        is_tradable, status, metadata_json, created_at, updated_at)
       VALUES ('instrument_demo_legacy', 'DEMO001.SZ', '旧示例股票', 'stock', 'common_stock',
        'cn', 'CNY', '示例', 1, 'active', '{}', ?, ?)`,
      timestamp,
      timestamp,
    );
    runWrite(
      store.database,
      "UPDATE users SET demo_seed_key = 'demo-v1' WHERE id = ?",
      DEMO_USER_ID,
    );

    seedAdvisorDemo(store.database);

    expect(store.profile.getInstrument("DEMO001.SZ")).toBeNull();
    expect(store.profile.getInstrument("000001.SZ")?.name).toBe("平安银行");
  });

});
