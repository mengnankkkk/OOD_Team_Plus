import { describe, expect, it } from "vitest";
import { getConcentrationInsight } from "@/lib/financialHealth";
import type { HealthMetrics } from "@/types/app/asset";

const metricsWith = (concentration: HealthMetrics["concentration"]): Pick<HealthMetrics, "concentration"> => ({
  concentration,
});

describe("getConcentrationInsight", () => {
  it("describes the actual equity allocation without treating 40% as a universal limit", () => {
    const insight = getConcentrationInsight(metricsWith({
      topClass: "stock",
      topClassRatio: 0.41,
      topIndustry: "科技",
      topIndustryRatio: 0.29,
    }));

    expect(insight.label).toBe("股票占比");
    expect(insight.note).toContain("41%");
    expect(insight.note).toContain("权益市场波动");
    expect(insight.note).not.toContain("上限");
  });

  it("explains when a lower-volatility asset class leads the portfolio", () => {
    const insight = getConcentrationInsight(metricsWith({
      topClass: "cash",
      topClassRatio: 0.72,
      topIndustry: null,
      topIndustryRatio: 0,
    }));

    expect(insight.label).toBe("现金占比");
    expect(insight.note).toContain("72%");
    expect(insight.note).toContain("低波动资产");
  });
});
