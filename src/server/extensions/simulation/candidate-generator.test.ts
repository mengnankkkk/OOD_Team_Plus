import { describe, expect, it } from "vitest";

import type { PriceManifest } from "./candidate-generator";
import { normalizeScenarioOption } from "./candidate-generator";
import type { BranchScenarioOption } from "./scenario-contracts";

const manifest: PriceManifest = {
  prices: { a: "100", b: "50" },
  assets: {
    a: { assetType: "STOCK", sector: "TECH" },
    b: { assetType: "ETF", sector: "BROAD" },
  },
  feeRate: "0.001",
  capturedAt: "2026-07-24T00:00:00.000Z",
  sha256: "",
};

const baseOption: BranchScenarioOption = {
  label: "B · 再平衡",
  description: "降低集中度",
  strategy: "BALANCED",
  trades: [{ instrumentId: "a", action: "SELL", quantity: "1" }],
  targetAllocations: [],
  rationale: ["集中度过高"],
  counterEvidence: ["上涨时可能落后"],
  risks: ["仍然存在市场风险"],
  assumptions: ["使用冻结价格"],
  invalidationConditions: ["画像发生变化"],
};

describe("candidate generator scenario normalization", () => {
  it("attaches server-owned frozen prices and strips model execution details", () => {
    const candidate = normalizeScenarioOption(baseOption, {
      objective: "降低集中度",
      parentCash: "100",
      holdings: [{ instrumentId: "a", quantity: "2", marketValue: "200" }],
      allowedInstrumentIds: new Set(["a", "b"]),
      priceManifest: manifest,
    });

    expect(candidate.trades[0]).toMatchObject({ instrumentId: "a", action: "SELL", quantity: "1", price: "100" });
    expect(candidate.analysis.rationale).toEqual(["集中度过高"]);
    expect(candidate.analysis.counterEvidence).toEqual(["上涨时可能落后"]);
  });

  it("rejects model plans that reference unknown instruments", () => {
    expect(() => normalizeScenarioOption({
      ...baseOption,
      trades: [{ instrumentId: "not-allowed", action: "BUY", quantity: "1" }],
    }, {
      objective: "降低集中度",
      parentCash: "100",
      holdings: [],
      allowedInstrumentIds: new Set(["a", "b"]),
      priceManifest: manifest,
    })).toThrow("SCENARIO_UNKNOWN_INSTRUMENT");
  });

  it("rejects oversells before the deterministic engine runs", () => {
    expect(() => normalizeScenarioOption({
      ...baseOption,
      trades: [{ instrumentId: "a", action: "SELL", quantity: "3" }],
    }, {
      objective: "降低集中度",
      parentCash: "100",
      holdings: [{ instrumentId: "a", quantity: "2", marketValue: "200" }],
      allowedInstrumentIds: new Set(["a", "b"]),
      priceManifest: manifest,
    })).toThrow("SCENARIO_INSUFFICIENT_HOLDING");
  });
});
