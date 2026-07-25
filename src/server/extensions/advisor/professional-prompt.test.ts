import { describe, expect, it } from "vitest";

import { chiefPrompt } from "./professional";

describe("chiefPrompt", () => {
  it("includes a zero cash balance, goals, and full holding facts", () => {
    const prompt = chiefPrompt(
      "生成今日组合建议",
      { risk_level: "R3" },
      [{
        name: "长期增值",
        target_amount_decimal: "500000",
        target_date: "2035-12-31",
        horizon: "LONG",
        priority: "1",
        asset_preference: "INDEX",
      }],
      [{
        instrument_id: "AAPL",
        symbol: "AAPL",
        name: "Apple",
        asset_type: "stock",
        market: "US",
        sector: "Technology",
        quantity_decimal: "2",
        cost_decimal: "140",
        price_decimal: "155",
        market_value_decimal: "310",
        unrealized_pnl_decimal: "30",
        weight_bps: 10000,
      }],
      {
        id: "snapshot-zero-cash",
        as_of: "2026-07-25T00:00:00.000Z",
        cash_decimal: "0",
        total_market_value_decimal: "310",
        data_quality: "complete",
      },
      null,
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
      [],
      ["PROFILE_CONTEXT", "DATA_RESEARCH", "PORTFOLIO_RISK"],
      { available: true, domains: [], tables: [], columns: [], toolCallIds: [] },
      true,
    );

    expect(prompt).toContain('"cash":"0"');
    expect(prompt).toContain('"unrealizedPnl":"30"');
    expect(prompt).toContain('"snapshotId":"snapshot-zero-cash"');
    expect(prompt).toContain('"name":"长期增值"');
    expect(prompt).toContain("LATEST_TRADING_DAY 表示");
  });
});
