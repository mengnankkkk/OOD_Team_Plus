import { describe, expect, it } from "vitest";

import { calculatePortfolioMetrics, calculateTechnicalIndicators, runPortfolioStressTests } from "./financial-engine";

describe("financial engine", () => {
  it("excludes cash from invested concentration and preserves decimal precision", () => {
    const metrics = calculatePortfolioMetrics("1000000000000000.01", [
      { instrumentId: "A", assetType: "STOCK", sector: "TECH", quantity: "0.1", price: "3", cost: "2" },
      { instrumentId: "B", assetType: "ETF", sector: "BROAD", quantity: "0.2", price: "1.5", cost: "1" },
    ]);
    expect(metrics.totalMarketValue).toBe("0.6");
    expect(metrics.concentrationHhi).toBe("0.5");
    expect(metrics.largestPositionWeight).toBe("0.5");
  });

  it("calculates deterministic technical indicators without inventing missing values", () => {
    const values = Array.from({ length: 80 }, (_, index) => String(100 + index));
    const indicators = calculateTechnicalIndicators(values);
    expect(indicators.ma20).not.toBeNull();
    expect(indicators.ma60).not.toBeNull();
    expect(indicators.rsi14).toBe("100");
    expect(indicators.macd).not.toBeNull();
    expect(indicators.missing).toEqual([]);
  });

  it("returns explicit stress assumptions and no probability claims", () => {
    const results = runPortfolioStressTests("100", [
      { instrumentId: "A", assetType: "STOCK", sector: "TECH", quantity: "2", price: "100" },
    ]);
    expect(results.map((item) => item.scenario)).toEqual(expect.arrayContaining(["BASE", "EQUITY_DOWN_20", "SECTOR_SHOCK", "CONCENTRATION_SHOCK", "LIQUIDITY_DISCOUNT", "BULL", "BEAR"]));
    expect(results.find((item) => item.scenario === "CONCENTRATION_SHOCK")?.changeAmount).toBe("-60");
    expect(results.every((item) => item.assumptions.length > 0)).toBe(true);
  });
});
