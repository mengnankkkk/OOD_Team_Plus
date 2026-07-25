import { describe, expect, it } from "vitest";

import { buildPortfolioRecommendationDraft, criticalMissingInformation, marketForHolding } from "./professional";

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
});
