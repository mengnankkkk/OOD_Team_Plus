import { describe, expect, it } from "vitest";

import { completeScenarioEvidence } from "./scenario-evidence";

describe("completeScenarioEvidence", () => {
  it("replaces template evidence with facts from market research", () => {
    const evidence = completeScenarioEvidence({
      strategy: "HOLD",
      trades: [],
      rationale: ["基于当前分支上下文生成的模型候选"],
      counterEvidence: ["市场变化可能使当前方案失效"],
      risks: ["候选结果仅用于模拟，不代表未来收益"],
    }, {
      objective: "降低集中度",
      research: [{
        instrumentId: "asset-a",
        symbol: "AAA",
        source: "PandaData",
        method: "get_stock_daily",
        fresh: true,
        asOfDate: "2026-07-24",
        sampleCount: 20,
        periodStartClose: "100",
        latestClose: "112.5",
        periodReturn: "12.5",
        periodHigh: "115",
        periodLow: "98",
        dataStatus: "VALID",
      }],
      holdings: [
        { symbol: "AAA", market_value_decimal: "800" },
        { symbol: "BBB", market_value_decimal: "200" },
      ],
    }, { concentrationHhi: 0.68, bearCaseReturn: -0.12 });

    expect(evidence.rationale.join(" ")).toContain("AAA");
    expect(evidence.rationale.join(" ")).toContain("12.50%");
    expect(evidence.counterEvidence.join(" ")).toContain("2026-07-24");
    expect(evidence.risks.join(" ")).toContain("80.0%");
    expect(JSON.stringify(evidence)).not.toContain("基于当前分支上下文生成的模型候选");
    expect(JSON.stringify(evidence)).not.toContain("市场变化可能使当前方案失效");
    expect(JSON.stringify(evidence)).not.toContain("候选结果仅用于模拟，不代表未来收益");
  });
});
