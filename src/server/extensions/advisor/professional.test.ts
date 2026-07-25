/* eslint-disable max-lines */
import { describe, expect, it } from "vitest";

import {
  buildPortfolioRecommendationDraft,
  classifyResearchDataState,
  criticalMissingInformation,
  deterministicAdvisorSummary,
  enforcePublicationStatus,
  formatAdvisorDecisionAnswer,
  marketForHolding,
  resolveTargetInstrument,
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
      debateSuggestion: {
        recommended: false,
        motion: "当前测试不进入多空 Battle",
        reason: "本用例只验证服务端发布状态。",
      },
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
        debateSuggestion: {
          recommended: false,
          motion: "当前测试不进入多空 Battle",
          reason: "本用例只验证非市场任务发布状态。",
        },
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

  it("requires a target before factor research or strategy backtesting", () => {
    expect(criticalMissingInformation("FACTOR_RESEARCH", undefined, null, null, false)).toEqual(["instrument"]);
    expect(criticalMissingInformation("STRATEGY_BACKTEST", undefined, null, null, false)).toEqual(["instrument"]);
    expect(criticalMissingInformation("FACTOR_RESEARCH", undefined, { id: "aapl", symbol: "AAPL", name: "Apple", asset_type: "stock", market: "US" }, null, false)).toEqual([]);
  });
});

describe("resolveTargetInstrument", () => {
  const instruments = [
    { id: "cambricon", symbol: "688256.SH", name: "寒武纪", asset_type: "stock", market: "CN" },
    { id: "apple", symbol: "AAPL.US", name: "Apple", asset_type: "stock", market: "US" },
    { id: "microsoft", symbol: "MSFT.US", name: "Microsoft", asset_type: "stock", market: "US" },
  ];

  it("resolves a named holding from natural-language trading intent", () => {
    expect(resolveTargetInstrument({
      content: "我想加仓抄底寒武纪",
      instruments,
      holdings: [{
        instrument_id: "cambricon",
        symbol: "688256.SH",
        name: "寒武纪",
        asset_type: "stock",
        market: "CN",
        sector: "Technology",
        quantity_decimal: "100",
        cost_decimal: "500",
        price_decimal: "600",
        market_value_decimal: "60000",
        unrealized_pnl_decimal: "10000",
        weight_bps: 6000,
      }],
    })).toEqual(instruments[0]);
  });

  it("keeps an explicit trusted symbol ahead of a different name in the message", () => {
    expect(resolveTargetInstrument({
      content: "我想加仓寒武纪",
      targetSymbol: "AAPL.US",
      instruments,
    })).toEqual(instruments[1]);
  });

  it("does not collapse explicit exchange suffixes onto another market", () => {
    const crossMarket = [
      { id: "ping-an-bank", symbol: "000001.SZ", name: "平安银行", asset_type: "stock", market: "SZ" },
      { id: "fund", symbol: "000001.OF", name: "测试基金", asset_type: "fund", market: "OF" },
    ];

    expect(resolveTargetInstrument({
      content: "请分析 000001.OF",
      instruments: crossMarket,
      holdings: [{
        instrument_id: "ping-an-bank",
        symbol: "000001.SZ",
        name: "平安银行",
        asset_type: "stock",
        market: "SZ",
        sector: "Financials",
        quantity_decimal: "100",
        cost_decimal: "10",
        price_decimal: "11",
        market_value_decimal: "1100",
        unrealized_pnl_decimal: "100",
        weight_bps: 10000,
      }],
    })).toEqual(crossMarket[1]);
  });

  it("finds a valid ticker after ordinary English words", () => {
    expect(resolveTargetInstrument({
      content: "Please analyze AAPL",
      instruments,
    })).toEqual(instruments[1]);
  });

  it("resolves a standalone bare numeric symbol when it is unique", () => {
    expect(resolveTargetInstrument({
      content: "688256怎么样",
      instruments,
    })).toEqual(instruments[0]);
  });

  it("treats independently mentioned instruments as ambiguous", () => {
    expect(resolveTargetInstrument({
      content: "比较 Apple 和 Microsoft",
      instruments,
    })).toBeNull();
  });

  it("does not match an English instrument name inside another word", () => {
    expect(resolveTargetInstrument({
      content: "pineapple 相关消费趋势怎么样",
      instruments,
    })).toBeNull();
  });

  it("matches multi-word English instrument names without substring matching", () => {
    const fund = { id: "gld", symbol: "GLD.US", name: "SPDR Gold Shares", asset_type: "fund", market: "US" };

    expect(resolveTargetInstrument({
      content: "What do you think about SPDR Gold Shares?",
      instruments: [fund],
    })).toEqual(fund);
  });

  it("does not ignore an unknown explicit numeric code in favor of a name", () => {
    expect(resolveTargetInstrument({
      content: "请分析 999999，不是寒武纪",
      instruments,
    })).toBeNull();
  });

  it("does not ignore an unknown suffixed ticker in favor of a name", () => {
    expect(resolveTargetInstrument({
      content: "请分析 UNKNOWN.US，不是寒武纪",
      instruments,
    })).toBeNull();
  });
});

describe("formatAdvisorDecisionAnswer", () => {
  it("uses Chinese status and action labels without exposing internal publication diagnostics", () => {
    const answer = formatAdvisorDecisionAnswer(
      {
        action: "SCALE_IN",
        requestedDirection: "BUY",
        summary: "当前不适合继续提高单一股票集中度",
        suitability: "LOW",
        confidence: 0.45,
        rationales: ["集中度已经偏高"],
        counterEvidence: ["长期逻辑仍可能成立"],
        risks: ["单一股票波动会主导组合回撤"],
        portfolioImpact: "加仓会进一步提高集中度",
        invalidationConditions: ["组合集中度明显下降"],
        compliance: {
          approved: false,
          decision: "BLOCKED",
          reason: "加仓会使集中度继续上升，建议暂缓",
        },
        debateSuggestion: {
          recommended: false,
          motion: "当前问题暂不适合进入多空 Battle",
          reason: "先控制组合集中度。",
        },
      },
      "BLOCKED",
      [{
        agent: "COMPLIANCE_REVIEWER",
        conclusion: "当前集中度风险不支持继续加仓",
        supportEvidence: ["已检查组合集中度"],
        counterEvidence: ["市场走势可能变化"],
        missingInformation: [],
        risks: ["集中度过高"],
        confidence: 0.9,
        needsAnotherAgent: false,
      }],
      {
        dataState: "LATEST_TRADING_DAY",
        executions: [],
        closes: [],
        latest: null,
        asOfDate: "2026-07-24",
        quotes: [],
        riskMetrics: [],
        correlations: [],
      },
      [
        "Chief Advisor 结构化输出未通过完整 schema，coercion 补全或修正字段：rationales",
        "Chief Advisor 合规决策为 BLOCKED：加仓会使集中度继续上升",
      ],
      { risk_level: "R5", horizon: "LONG" },
      [],
    );

    expect(answer).toContain("建议状态：暂不执行");
    expect(answer).toContain("建议动作：暂缓加仓");
    expect(answer).not.toContain("BLOCKED");
    expect(answer).not.toContain("SCALE_IN");
    expect(answer).not.toContain("schema");
    expect(answer).not.toContain("coercion");
    expect(answer).not.toContain("发布门保留原因");
  });
});
