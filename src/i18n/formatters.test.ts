import { describe, expect, it } from "vitest";

import { formatCny, formatDateTime, formatPercent } from "./formatters";

describe("locale formatters", () => {
  it("formats CNY and percentages with the requested locale", () => {
    expect(formatCny(123456, "en-US")).toContain("CN¥");
    expect(formatPercent(0.125, "en-US")).toBe("12.5%");
  });

  it("uses the fallback for invalid date values", () => {
    expect(formatDateTime("invalid", "en-US", { fallback: "—" })).toBe("—");
  });
});
