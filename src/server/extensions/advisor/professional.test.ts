import { describe, expect, it } from "vitest";

import {
  buildPortfolioRecommendationDraft,
  classifyResearchDataState,
  criticalMissingInformation,
  deterministicAdvisorSummary,
  enforcePublicationStatus,
  marketForHolding,
} from "./professional";
import type { AdvisorDecision } from "./professional";

describe("buildPortfolioRecommendationDraft", () => {
  it("creates a portfolio-level recommendation without inventing a target security", () => {
    const draft = buildPortfolioRecommendationDraft({
      status: "ACTIVE",
      candidate: {
        action: "HOLD",
        requestedDirection: "ANALYZE",
        summary: "维持核心仓位，并降低单一持仓集中度",
        suitability: "MEDIUM",
        confidence: 0.82,
        rationales: ["最大持仓权重接近风险预算上限"],
        counterEvidence: ["市场趋势仍可能延续"],
        risks: ["单一持仓波动可能放大组合回撤"],
        portfolioImpact: "不增加总风险预算，优先通过再平衡降低集中度",
        invalidationConditions: ["持仓或用户资金用途发生变化"],
        compliance: { approved: true, decision: "APPROVED", reason: "通过" },
      },
      profile: {
        max_drawdown_decimal: "0.12",
        horizon: "LONG",
      },
      holdings: [{
        instrument_id: "AAPL",
        symbol: "AAPL",
        name: "Apple",
        asset_type: "stock",
        sector: "Technology",
        quantity_decimal: "2",
        cost_decimal: "140",
        price_decimal: "155",
        market_value_decimal: "310",
        unrealized_pnl_decimal: "30",
        weight_bps: 6200,
      }],
      research: {
        dataState: "LIVE_FRESH",
        executions: [],
        closes: [],
        latest: null,
        asOfDate: "2026-07-25",
        quotes: [],
      },
      snapshot: {
        id: "snapshot-today",
        as_of: "2026-07-25T00:00:00.000Z",
        cash_decimal: "190",
        total_market_value_decimal: "310",
      },
    } as never);

    expect(draft.instrumentId).toBeNull();
    expect(draft.symbol).toBeNull();
    expect(draft.summary).toContain("降低单一持仓集中度");
    expect(draft.stopLoss).toContain("12%");
    expect(draft.referenceRange).toEqual(["组合级建议不设置单一证券价格区间"]);
    expect(draft.provenance).toEqual(expect.objectContaining({
      scope: "PORTFOLIO",
      snapshotId: "snapshot-today",
    }));
  });

  it("blocks portfolio diagnosis when profile or holdings are incomplete", () => {
    expect(criticalMissingInformation("DIAGNOSIS", undefined, null, null, false)).toEqual(expect.arrayContaining([
      "risk_level",
      "investment_amount",
      "horizon",
      "max_drawdown",
      "instrument_preference",
      "near_term_use",
      "holdings",
    ]));
  });

  it("allows daily portfolio diagnosis to use temporary profile assumptions", () => {
    expect(criticalMissingInformation("DIAGNOSIS", undefined, null, null, true, true)).toEqual([]);
  });

  it("uses a concise portfolio headline when market evidence blocks publication", () => {
    const draft = buildPortfolioRecommendationDraft({
      status: "BLOCKED",
      candidate: {
        action: "WATCH",
        requestedDirection: "ANALYZE",
        summary: "这是一段来自模型的很长说明，包含数据不可用、组合集中度、压力测试和后续重新评估条件，不适合直接作为首页建议卡标题展示。",
        suitability: "LOW",
        confidence: 0.4,
        rationales: ["PandaData 登录失败"],
        counterEvidence: ["缺少真实市场数据"],
        risks: ["不能形成实盘依据"],
        portfolioImpact: "维持现有组合",
        invalidationConditions: ["数据服务恢复"],
        compliance: { approved: false, decision: "BLOCKED", reason: "关键行情数据不可用" },
      },
      profile: { max_drawdown_decimal: "0.12", horizon: "LONG" },
      holdings: [{
        instrument_id: "AAPL", symbol: "AAPL", name: "Apple", asset_type: "stock", sector: "Technology",
        quantity_decimal: "2", cost_decimal: "140", price_decimal: "155", market_value_decimal: "310",
        unrealized_pnl_decimal: "30", weight_bps: 10000,
      }],
      research: { dataState: "UNAVAILABLE", executions: [], closes: [], latest: null, asOfDate: null, quotes: [] },
      snapshot: { id: "snapshot-blocked", as_of: "2026-07-25T00:00:00.000Z", cash_decimal: "0" },
    } as never);

    expect(draft.summary).toBe("关键行情数据不可用，今日暂不调整组合");
    expect(draft.firstPosition).toBe("今日不调整；数据恢复后重新评估");
    expect(draft.reasons.some((reason) => reason.includes("很长说明"))).toBe(true);
  });

  it("uses instrument market metadata when a holding symbol has no suffix", () => {
    expect(marketForHolding({ symbol: "AAPL", market: "US" })).toBe("US");
    expect(marketForHolding({ symbol: "000001.SZ", market: null })).toBe("SZ");
  });

  it("keeps deterministic portfolio summaries self-contained and aware of profile completeness", () => {
    expect(deterministicAdvisorSummary({
      targetSymbol: null,
      profileReady: true,
      hasHoldings: true,
      concentrationRisk: false,
    })).toBe("已完成画像与组合诊断，当前组合以继续观察为主");
    expect(deterministicAdvisorSummary({
      targetSymbol: null,
      profileReady: true,
      hasHoldings: false,
      concentrationRisk: false,
    })).toBe("请先补充当前持仓，完成组合诊断后再形成具体标的建议");
  });

  it("accepts the latest official trading day while keeping older fallback data stale", () => {
    const freshExecution = {
      source: { method: "get_stock_rt_daily" },
      result: { liveCallSucceeded: true, data: [{ close: 100 }], fresh: true },
    };
    const latestDailyExecution = {
      source: { method: "get_stock_daily" },
      result: {
        liveCallSucceeded: true,
        data: [{ close: 100, date: "20260724" }],
        fresh: true,
        asOfDate: "2026-07-24",
      },
    };

    expect(classifyResearchDataState([freshExecution] as never, false)).toBe("LIVE_FRESH");
    expect(classifyResearchDataState([latestDailyExecution] as never, true, "2026-07-24")).toBe("LATEST_TRADING_DAY");
    expect(classifyResearchDataState([latestDailyExecution] as never, true, "2026-07-23")).toBe("STALE");
    expect(classifyResearchDataState([{
      source: { method: "get_stock_rt_daily" },
      result: { liveCallSucceeded: true, data: [], fresh: true },
    }] as never, false)).toBe("UNAVAILABLE");
  });

  it("blocks stale trading advice and model-level compliance failures", () => {
    const candidate: AdvisorDecision = {
      action: "HOLD",
      requestedDirection: "ANALYZE",
      summary: "继续观察",
      suitability: "MEDIUM",
      confidence: 0.8,
      rationales: ["组合风险可控"],
      counterEvidence: ["市场仍可能波动"],
      risks: ["历史数据不能代表未来"],
      portfolioImpact: "维持当前风险预算",
      invalidationConditions: ["画像变化"],
      compliance: { approved: true, decision: "APPROVED", reason: "通过" },
    };
    const findings = [{
      agent: "COMPLIANCE_REVIEWER",
      conclusion: "通过",
      supportEvidence: ["画像完整"],
      counterEvidence: ["市场仍可能波动"],
      missingInformation: [],
      risks: [],
      confidence: 0.9,
      needsAnotherAgent: false,
    }] as never;

    expect(enforcePublicationStatus({
      candidate,
      criticalMissing: [],
      dataState: "STALE",
      findings,
      modelFallback: false,
      unresolvedConflict: false,
      marketDataRequired: true,
    })).toBe("BLOCKED");
    expect(enforcePublicationStatus({
      candidate,
      criticalMissing: [],
      dataState: "LATEST_TRADING_DAY",
      findings,
      modelFallback: false,
      unresolvedConflict: false,
      marketDataRequired: true,
      latestTradingDayAllowed: true,
    } as never)).toBe("ACTIVE");
    expect(enforcePublicationStatus({
      candidate: {
        ...candidate,
        compliance: { approved: false, decision: "BLOCKED", reason: "合规阻断" },
      },
      criticalMissing: [],
      dataState: "LIVE_FRESH",
      findings,
      modelFallback: false,
      unresolvedConflict: false,
      marketDataRequired: true,
    })).toBe("BLOCKED");
  });

  it("allows a fully supported non-market task to publish without fake market data", () => {
    expect(enforcePublicationStatus({
      candidate: {
        action: "HOLD",
        requestedDirection: "ANALYZE",
        summary: "完成画像说明",
        suitability: "MEDIUM",
        confidence: 0.8,
        rationales: ["画像完整"],
        counterEvidence: ["资金用途变化会使结论失效"],
        risks: ["画像可能变化"],
        portfolioImpact: "不改变持仓",
        invalidationConditions: ["画像变化"],
        compliance: { approved: true, decision: "APPROVED", reason: "通过" },
      },
      criticalMissing: [],
      dataState: "NOT_REQUIRED",
      findings: [{
        agent: "COMPLIANCE_REVIEWER",
        conclusion: "通过",
        supportEvidence: ["画像完整"],
        counterEvidence: ["画像可能变化"],
        missingInformation: [],
        risks: [],
        confidence: 0.9,
        needsAnotherAgent: false,
      }],
      modelFallback: false,
      unresolvedConflict: false,
      marketDataRequired: false,
    })).toBe("ACTIVE");
  });
});
