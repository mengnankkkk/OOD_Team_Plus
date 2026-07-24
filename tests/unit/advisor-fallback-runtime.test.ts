import { describe, expect, it } from "vitest";

import { DeterministicAdvisorRuntime } from "@/server/advisor/fallback-runtime";
import type { PandadataProbe } from "@/server/advisor/pandadata";
import { AdvisorStore } from "@/server/advisor/store";

describe("advisor deterministic fallback runtime", () => {
  it("uses a real sector ETF and research card for a tech question", async () => {
    const store = new AdvisorStore();
    const adapter = {
      async fetch(method: string) {
        const isDetail = method === "get_fund_detail";
        return {
          method,
          ok: true,
          contractValidated: true,
          runtimeConfigured: true,
          liveCallSucceeded: true,
          liveDataFresh: true,
          mode: "live" as const,
          rows: isDetail ? 1 : 3,
          data: isDetail
            ? [{ symbol: "515000.SH", name: "华宝中证科技龙头ETF", benchmark: "中证科技龙头指数收益率×100%" }]
            : [
              { symbol: "515000.SH", date: "20260723", close: 1.334, change_rate: -0.02 },
              { symbol: "515000.SH", date: "20260722", close: 1.362, change_rate: -0.02 },
              { symbol: "515000.SH", date: "20260721", close: 1.39, change_rate: 0.09 },
            ],
          asOfDate: isDetail ? undefined : "20260723",
          summary: `${method} live`,
        } as PandadataProbe;
      },
    };
    const output = await new DeterministicAdvisorRuntime(store, adapter).run({
      conversationId: "conversation_fallback_research",
      question: "科技板块最近跌得很厉害，现在是不是入场时机？",
    });

    expect(output.decision.primaryInstrument).toMatchObject({ symbol: "515000.SH" });
    expect(output.researchBundles?.[0]).toMatchObject({
      symbol: "515000.SH",
      name: "华宝中证科技龙头ETF",
      dataQuality: "MEDIUM",
      market: { lastPrice: "1.334" },
    });
    expect(output.researchBundles?.[0].supportEvidence).not.toContain(
      "估值历史分位偏低，具备观察价值。",
    );
    expect(output.dataResults.every((result) => result.liveDataFresh)).toBe(true);
  });
});
