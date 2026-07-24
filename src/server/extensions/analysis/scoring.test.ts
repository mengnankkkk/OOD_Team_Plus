import { describe, expect, it } from "vitest";

import { calculatePortfolioScore } from "./scoring";

describe("calculatePortfolioScore", () => {
  it("returns scores in 0-100 range", () => {
    const score = calculatePortfolioScore(10000, [
      { instrumentId: "A", quantity: "100", price: "50", marketValue: "5000", weightBps: 5000 },
      { instrumentId: "B", quantity: "50", price: "100", marketValue: "5000", weightBps: 5000 },
    ]);

    expect(score.healthScore).toBeGreaterThanOrEqual(0);
    expect(score.healthScore).toBeLessThanOrEqual(100);
    expect(score.riskScore).toBeGreaterThanOrEqual(0);
    expect(score.riskScore).toBeLessThanOrEqual(100);
    expect(score.scoreVersion).toBe("v1.0");
    expect(score.missingMetrics).toEqual(["return", "drawdown", "volatility"]);
  });

  it("treats a single non-cash holding as fully concentrated", () => {
    const score = calculatePortfolioScore(5000, [
      { instrumentId: "A", quantity: "100", price: "50", marketValue: "5000", weightBps: 10000 },
    ]);

    expect(score.components.concentrationScore).toBe(0);
  });

  it("maps supplied metrics and clamps their component scores", () => {
    const score = calculatePortfolioScore(10000, [], -75, -60, 60);

    expect(score.components.returnScore).toBe(0);
    expect(score.components.drawdownScore).toBe(0);
    expect(score.components.volatilityScore).toBe(0);
    expect(score.components.liquidityScore).toBe(0);
    expect(score.missingMetrics).toEqual([]);
  });
});
