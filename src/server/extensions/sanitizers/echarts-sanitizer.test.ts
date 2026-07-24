import { describe, expect, it } from "vitest";

import { MAX_ECHARTS_BYTES, sanitizeEChartsOption } from "./echarts-sanitizer";

describe("sanitizeEChartsOption", () => {
  it("rejects function strings", () => {
    const result = sanitizeEChartsOption({ series: [{ type: "line", label: { formatter: "function () { return 1; }" } }] });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Function strings are not allowed in ECharts options");
  });

  it("rejects chart types outside the whitelist", () => {
    const result = sanitizeEChartsOption({ series: [{ type: "candlestick" }] });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Chart type not allowed");
  });

  it("rejects content larger than 512 KiB", () => {
    const result = sanitizeEChartsOption({ payload: "x".repeat(MAX_ECHARTS_BYTES + 1) });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("ECharts option exceeds 512 KiB limit");
  });

  it("accepts a valid pie chart", () => {
    const result = sanitizeEChartsOption({ series: [{ type: "pie", data: [{ value: 1, name: "A" }] }] });

    expect(result.valid).toBe(true);
    expect(result.sanitized).toEqual({ series: [{ type: "pie", data: [{ value: 1, name: "A" }] }] });
  });
});
