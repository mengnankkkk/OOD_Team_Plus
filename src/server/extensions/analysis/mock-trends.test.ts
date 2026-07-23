import { describe, expect, it } from "vitest";

import { generateMockTrends } from "./mock-trends";

describe("generateMockTrends", () => {
  it("is deterministic for the same inputs", () => {
    const first = generateMockTrends("snap_123", "total_return");
    const second = generateMockTrends("snap_123", "total_return");

    expect(first.points).toEqual(second.points);
  });

  it("always identifies mock data and its model version", () => {
    const trend = generateMockTrends("snap_abc", "drawdown", 7);

    expect(trend.source).toBe("MOCK");
    expect(trend.modelVersion).toBe("mock-trend-v1");
    expect(trend.points).toHaveLength(7);
    expect(trend.points.every((point) => point.value >= -50 && point.value <= 50)).toBe(true);
  });
});
