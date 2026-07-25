import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BranchScenarioOptionSchema,
  BranchScenarioPlanSchema,
  } from "./scenario-contracts";
import { normalizeModelTrades, runBranchScenarioAgent } from "./scenario-agent";

const baseInput = {
  objective: "降低组合集中度",
  profile: { risk_level: "稳健型", max_drawdown_decimal: "0.12" },
  snapshot: { cash_decimal: "10000", total_market_value_decimal: "500" },
  holdings: [
    { instrument_id: "instrument_a", quantity_decimal: "2", market_value_decimal: "300" },
    { instrument_id: "instrument_b", quantity_decimal: "1", market_value_decimal: "200" },
  ],
  instruments: [
    { id: "instrument_a", symbol: "AAA", name: "A", asset_type: "STOCK", tradable: 1 },
    { id: "instrument_b", symbol: "BBB", name: "B", asset_type: "ETF", tradable: 1 },
    { id: "instrument_c", symbol: "CCC", name: "C", asset_type: "ETF", tradable: 1 },
  ],
  research: [],
  riskConstraints: { maxDrawdown: "0.12" },
};

beforeEach(() => {
  vi.stubEnv("DEEPSEEK_API_KEY", "");
});

describe("branch scenario contracts", () => {
  it("normalizes zero and duplicate model trade intents before strict publication", () => {
    expect(normalizeModelTrades([
      { instrumentId: "instrument_a", action: "BUY", quantity: 1 },
      { instrumentId: "instrument_a", action: "BUY", quantity: "2.5" },
      { instrumentId: "instrument_a", action: "BUY", quantity: 0 },
    ])).toEqual([{ instrumentId: "instrument_a", action: "BUY", quantity: "3.5" }]);
  });

  it("accepts a structured plan without model-owned execution prices", () => {
    const plan = BranchScenarioPlanSchema.parse({
      provider: "CHIEF_ADVISOR",
      options: [{
        label: "B · 风险预算再平衡",
        description: "降低集中度",
        strategy: "BALANCED",
        trades: [{ instrumentId: "instrument_a", action: "SELL", quantity: "1" }],
        targetAllocations: [],
        rationale: ["集中度过高"],
        counterEvidence: ["上涨时可能落后"],
        risks: ["仍存在市场风险"],
        assumptions: ["使用冻结价格"],
        invalidationConditions: ["画像发生变化"],
      }],
      delegatedAgents: ["PROFILE_CONTEXT", "PORTFOLIO_RISK", "SCENARIO_PLANNER"],
    });

    expect(plan.options[0].strategy).toBe("BALANCED");
    expect(plan.options[0].trades[0]).not.toHaveProperty("price");
  });

  it("rejects malformed or unsafe option output", () => {
    expect(() => BranchScenarioOptionSchema.parse({
      label: "bad",
      description: "bad",
      strategy: "BALANCED",
      trades: [{ instrumentId: "instrument_a", action: "SELL", quantity: "0" }],
      targetAllocations: [],
      rationale: [],
      counterEvidence: [],
      risks: [],
      assumptions: [],
      invalidationConditions: [],
    })).toThrow();
  });

  it("returns a visible deterministic fallback when the model is unavailable", async () => {
    const result = await runBranchScenarioAgent(baseInput);

    expect(result.provider).toBe("DETERMINISTIC_FALLBACK");
    expect(result.fallbackReason).toBe("MODEL_NOT_CONFIGURED");
    expect(result.plan.options).toHaveLength(3);
    expect(result.plan.options.map((option) => option.strategy)).toEqual(["HOLD", "BALANCED", "DEFENSIVE"]);
    expect(result.delegatedAgents).toContain("DETERMINISTIC_FALLBACK");
  });
});
