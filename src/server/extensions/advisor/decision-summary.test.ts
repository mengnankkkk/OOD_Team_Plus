import { describe, expect, it } from "vitest";

import { deterministicAdvisorSummary } from "./decision-summary";

describe("deterministicAdvisorSummary", () => {
  it("describes the completed portfolio diagnosis when holdings already exist", () => {
    expect(deterministicAdvisorSummary({
      targetSymbol: null,
      profileReady: true,
      hasHoldings: true,
      concentrationRisk: false,
    })).toBe("已完成画像与组合诊断，当前组合以继续观察为主");
  });

  it("asks for portfolio completion only when holdings are actually missing", () => {
    expect(deterministicAdvisorSummary({
      targetSymbol: null,
      profileReady: true,
      hasHoldings: false,
      concentrationRisk: false,
    })).toBe("请先补充当前持仓，完成组合诊断后再形成具体标的建议");
  });
});
