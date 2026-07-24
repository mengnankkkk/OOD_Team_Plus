import { describe, expect, it } from "vitest";

import { parseHoldingText } from "@/server/advisor/holding-parser";
import { MarketDataService } from "@/server/advisor/market-service";
import { derivePortfolioHealth } from "@/server/advisor/portfolio-service";
import { dateDaysAgo, dateYearsFromNow } from "@/server/advisor/date-utils";
import { paramsFor } from "@/server/advisor/stock-research-support";
import { newestProbeDate } from "@/server/advisor/stock-research-support";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { AdvisorStore } from "@/server/advisor/store";

describe("advisor data regressions", () => {
  it("resolves a real security name and quantity from natural language", () => {
    const store = new AdvisorStore();
    const draft = parseHoldingText(store, {
      userId: DEMO_USER_ID,
      text: "我买了平安银行100股，成本10.50元",
    });
    const candidate = draft.candidates[0];

    expect(candidate).toMatchObject({
      instrumentId: "instrument_000001_sz",
      symbol: "000001.SZ",
      name: "平安银行",
      quantity: "100",
      averageCost: "10.50",
      issues: [],
    });
  });

  it("keeps an index non-tradable and suggests the ETF instead", () => {
    const store = new AdvisorStore();
    const draft = parseHoldingText(store, {
      userId: DEMO_USER_ID,
      text: "沪深300指数在4000点时买了100股",
    });
    const candidate = draft.candidates[0];

    expect(candidate).toMatchObject({
      instrumentId: null,
      symbol: null,
      name: "沪深300指数",
    });
    expect(candidate.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DIRECT_INDEX_NOT_TRADABLE" }),
      ]),
    );
    expect(candidate.suggestedMatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ symbol: "510300.SH", tradable: true }),
      ]),
    );
  });

  it("prefers a tradable ETF when the user names an index without saying index", () => {
    const store = new AdvisorStore();
    const draft = parseHoldingText(store, {
      userId: DEMO_USER_ID,
      text: "我持有沪深300 2手，成本4.20元",
    });

    expect(draft.candidates[0]).toMatchObject({
      instrumentId: "instrument_510300_sh",
      symbol: "510300.SH",
      name: "沪深300ETF",
      quantity: "200",
      averageCost: "4.20",
      issues: [],
    });
  });

  it("requires a fresh tradable quantity and price when mapping an index to an ETF", () => {
    const store = new AdvisorStore();
    const draft = parseHoldingText(store, {
      userId: DEMO_USER_ID,
      text: "沪深300指数在4000点时买了100股",
    });
    const pending = store.holdings.getDraft(DEMO_USER_ID, draft.id)!;

    expect(() => store.holdings.confirmDraft(DEMO_USER_ID, draft.id, pending.candidates)).toThrow(
      "INDEX_HOLDING_MAPPING_REQUIRED",
    );
    expect(() => store.holdings.confirmDraft(DEMO_USER_ID, draft.id, [{
      ...pending.candidates[0],
      instrumentId: "instrument_510300_sh",
    }])).toThrow("INDEX_PRICE_REENTRY_REQUIRED");

    const confirmed = store.holdings.confirmDraft(DEMO_USER_ID, draft.id, [{
      ...pending.candidates[0],
      instrumentId: "instrument_510300_sh",
      symbol: "510300.SH",
      name: "沪深300ETF",
      quantity: "200",
      averageCost: "4.20",
    }]);

    expect(confirmed.holdings[0]).toMatchObject({
      instrument: { symbol: "510300.SH" },
      quantity: "200",
      averageCost: "4.20",
    });
  });

  it("recognizes quantity units after the security name", () => {
    const store = new AdvisorStore();
    const draft = parseHoldingText(store, {
      userId: DEMO_USER_ID,
      text: "平安银行持仓1.2万股，买入均价10.50元",
    });

    expect(draft.candidates[0]).toMatchObject({
      symbol: "000001.SZ",
      name: "平安银行",
      quantity: "12000",
      averageCost: "10.50",
      issues: [],
    });
  });

  it("uses the current date window for market requests", async () => {
    const store = new AdvisorStore();
    const instrument = store.profile.getInstrument("000001.SZ")!;
    let requestedParams: Record<string, unknown> | undefined;
    const adapter = {
      async fetch(_method: string, params: Record<string, unknown>) {
        requestedParams = params;
        return {
          method: "get_stock_daily",
          ok: false,
          contractValidated: true,
          runtimeConfigured: true,
          liveCallSucceeded: false,
          liveDataFresh: false,
          mode: "live" as const,
          summary: "test",
        };
      },
    };

    await new MarketDataService(store, adapter).getSnapshot(instrument);

    const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    expect(requestedParams?.end_date).toBe(today);
    expect(requestedParams?.start_date).not.toBe("20260101");
  });

  it("derives portfolio health from data quality and risk evidence", () => {
    expect(derivePortfolioHealth({
      hasHoldings: false,
      dataFresh: false,
      currentDrawdown: 0,
      maxAcceptableDrawdown: 0.15,
      riskFitStatus: "WITHIN_LIMITS",
      topIssues: [],
    })).toMatchObject({ status: "insufficient_data", score: 0 });

    expect(derivePortfolioHealth({
      hasHoldings: true,
      dataFresh: true,
      currentDrawdown: -0.03,
      maxAcceptableDrawdown: 0.15,
      riskFitStatus: "WITHIN_LIMITS",
      topIssues: [],
    }).status).toBe("healthy");

    expect(derivePortfolioHealth({
      hasHoldings: true,
      dataFresh: false,
      currentDrawdown: -0.3,
      maxAcceptableDrawdown: 0.15,
      riskFitStatus: "MISMATCHED",
      topIssues: [{ severity: "HIGH" }],
    }).status).toBe("high_risk");
  });

  it("seeds holding dates into acquiredAt without shifting purpose and thesis", () => {
    const store = new AdvisorStore();
    const holdings = store.holdings.listHoldings(DEMO_USER_ID);
    const goal = store.profile.listGoals(DEMO_USER_ID)[0];

    expect(goal.targetDate).toBe(dateYearsFromNow(3));
    expect(holdings.every((holding) => holding.acquiredAt === dateDaysAgo(95))).toBe(true);
    expect(holdings.find((holding) => holding.id === "holding_demo_gold")).toMatchObject({
      purpose: "hedge",
      thesis: "黄金仓位保护组合，但已偏高",
    });
  });

  it("builds financial report quarters from the requested date", () => {
    expect(paramsFor(
      "get_fina_reports",
      "000001.SZ",
      { start_date: "20240724", end_date: "20260724" },
      "CN",
    )).toMatchObject({
      start_quarter: "2024q3",
      end_quarter: "2026q3",
    });
  });

  it("uses the latest market date instead of a static-detail retrieval date", () => {
    expect(newestProbeDate([
      {
        method: "get_fund_detail",
        ok: true,
        contractValidated: true,
        runtimeConfigured: true,
        liveCallSucceeded: true,
        liveDataFresh: true,
        mode: "live",
        asOfDate: "2026-07-24",
        summary: "detail",
      },
      {
        method: "get_fund_daily",
        ok: true,
        contractValidated: true,
        runtimeConfigured: true,
        liveCallSucceeded: true,
        liveDataFresh: true,
        mode: "live",
        asOfDate: "2026-07-23",
        summary: "daily",
      },
    ])).toBe("2026-07-23");
  });
});
