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
});
