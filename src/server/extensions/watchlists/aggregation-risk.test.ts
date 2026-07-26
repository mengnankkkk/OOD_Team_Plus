import { describe, expect, it } from "vitest";

import { computeRiskAggregate } from "./aggregation";

describe("watchlist risk aggregation", () => {
  it("uses the approved thresholds for risk direction", () => {
    expect(computeRiskAggregate(stableRiskPoints(1.26)).status).toBe("increasing");
    expect(computeRiskAggregate(stableRiskPoints(0.79)).status).toBe("decreasing");
    expect(computeRiskAggregate(stableRiskPoints(1.1)).status).toBe("stable");
    expect(computeRiskAggregate(stableRiskPoints(1).slice(0, 19))).toMatchObject({
      status: "insufficient_data",
      dataAsOf: null,
    });
  });
});

function stableRiskPoints(recentScale: number) {
  const prices = Array.from({ length: 20 }, () => 100);
  for (let index = 0; index < 9; index += 1) {
    prices.push(prices.at(-1)! * (1 + (index % 2 === 0 ? 0.01 : -0.01)));
  }
  prices.push(prices.at(-1)!);
  for (let index = 0; index < 9; index += 1) {
    prices.push(prices.at(-1)! * (1 + (index % 2 === 0 ? 0.01 : -0.01) * recentScale));
  }
  prices.push(prices.at(-1)!);
  return prices.map((close, index) => ({
    date: `2026-06-${String(index + 1).padStart(2, "0")}`,
    close,
    previousClose: index === 0 ? close : prices[index - 1],
  }));
}
