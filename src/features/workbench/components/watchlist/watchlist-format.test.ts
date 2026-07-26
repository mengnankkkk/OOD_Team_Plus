import { describe, expect, it } from "vitest";

import {
  conditionSummary,
  formatAvailability,
  formatPercentRatio,
} from "./watchlist-format";

describe("watchlist formatting", () => {
  it("keeps insufficient data explicit", () => {
    expect(formatAvailability("insufficient_data")).toBe("数据不足");
  });

  it("formats stored ratios as percentages", () => {
    expect(formatPercentRatio(0.1234)).toBe("12.34%");
  });

  it("summarizes a drawdown condition with its window", () => {
    expect(conditionSummary({
      conditionType: "DRAWDOWN_REACH",
      threshold: "0.12",
      thresholdDate: null,
      windowDays: 20,
    })).toBe("近 20 日回撤达到 12%");
  });
});
