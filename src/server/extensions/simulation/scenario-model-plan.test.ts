import { describe, expect, it } from "vitest";

import { parseBranchScenarioModelPlan } from "./scenario-model-plan";

describe("parseBranchScenarioModelPlan", () => {
  it("repairs optional narrative fields instead of discarding a usable model option", () => {
    const plan = parseBranchScenarioModelPlan({
      provider: "model-owned-field",
      options: [{
        label: "model-owned-label",
        description: "降低最大持仓集中度",
        strategy: "BALANCED",
        trades: [{ instrumentId: "a", action: "SELL", quantity: 1 }],
      }],
    }, {});

    expect(plan.options).toHaveLength(1);
    expect(plan.options[0]).toMatchObject({
      description: "降低最大持仓集中度",
      strategy: "BALANCED",
      trades: [{ instrumentId: "a", action: "SELL", quantity: "1" }],
      targetAllocations: [],
    });
    expect(plan.options[0]?.rationale.length).toBeGreaterThan(0);
    expect(plan.options[0]?.risks.length).toBeGreaterThan(0);
    expect(plan.delegatedAgents).toEqual([]);
  });

  it("repairs truncated envelopes, aliases, null fields, and numeric quantities", () => {
    const plan = parseBranchScenarioModelPlan({
      result: {
        candidates: [{
          summary: "降低最大持仓集中度",
          mode: "卖出",
          transactions: [
            { symbol: "a", side: "卖出", qty: 1 },
            { instrument_id: "a", action: "SELL", quantity: 0 },
            { instrument_id: "broken", action: "BUY" },
          ],
          rationale: "集中度过高",
          risks: null,
        }],
      },
    }, {});

    expect(plan.options).toHaveLength(1);
    expect(plan.options?.[0]).toMatchObject({
      description: "降低最大持仓集中度",
      strategy: "DEFENSIVE",
      trades: [{ instrumentId: "a", action: "SELL", quantity: "1" }],
      rationale: ["集中度过高"],
    });
    expect(plan.options?.[0]?.risks).toEqual(["候选结果仅用于模拟，不代表未来收益"]);
  });

  it("drops empty streamed placeholders while keeping a valid partial option", () => {
    const plan = parseBranchScenarioModelPlan({
      options: [{}, { description: "保持当前组合", strategy: "HOLD" }],
    }, {});

    expect(plan.options).toHaveLength(1);
    expect(plan.options?.[0]?.description).toBe("保持当前组合");
    expect(plan.options?.[0]?.trades).toEqual([]);
  });

  it("accepts a single bare candidate wrapped by a model payload", () => {
    const plan = parseBranchScenarioModelPlan({
      payload: {
        plan: {
          title: "小幅增加分散配置",
          mode: "买入",
          tradeIntents: [{
            instrument: { symbol: "ETF-A" },
            tradeAction: "买入",
            units: "2",
          }],
        },
      },
    }, {});

    expect(plan.options).toHaveLength(1);
    expect(plan.options?.[0]).toMatchObject({
      description: "小幅增加分散配置",
      strategy: "GROWTH",
      trades: [{ instrumentId: "ETF-A", action: "BUY", quantity: "2" }],
    });
  });
});
