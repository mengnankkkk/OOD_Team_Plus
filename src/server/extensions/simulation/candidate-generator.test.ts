import { describe, expect, it, vi } from "vitest";

import type { PriceManifest } from "./candidate-generator";
import {
  fetchScenarioInstrumentPrices,
  normalizeScenarioOption,
  normalizeValidScenarioOptions,
} from "./candidate-generator";
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

  it("clamps oversells to the available holding before execution", () => {
    const candidate = normalizeScenarioOption({
      ...baseOption,
      trades: [{ instrumentId: "a", action: "SELL", quantity: "3" }],
    }, {
      objective: "降低集中度",
      parentCash: "100",
      holdings: [{ instrumentId: "a", quantity: "2", marketValue: "200" }],
      allowedInstrumentIds: new Set(["a", "b"]),
      priceManifest: manifest,
    });

    expect(candidate.trades).toEqual([{ instrumentId: "a", action: "SELL", quantity: "2", price: "100" }]);
  });

  it("executes sells before buys and clamps buys to available simulated cash", () => {
    const candidate = normalizeScenarioOption({
      ...baseOption,
      trades: [
        { instrumentId: "b", action: "BUY", quantity: "10" },
        { instrumentId: "a", action: "SELL", quantity: "1" },
      ],
    }, {
      objective: "降低集中度",
      parentCash: "0",
      holdings: [{ instrumentId: "a", quantity: "2", marketValue: "200" }],
      allowedInstrumentIds: new Set(["a", "b"]),
      priceManifest: manifest,
    });

    expect(candidate.trades.map((trade) => trade.action)).toEqual(["SELL", "BUY"]);
    expect(Number(candidate.trades[1]?.quantity)).toBeGreaterThan(0);
    expect(Number(candidate.trades[1]?.quantity)).toBeLessThan(2);
  });

  it("fetches a missing frozen fund price from the market data source", async () => {
    const execute = vi.fn(async (options: { sources: Array<{ method: string; parameters: Record<string, unknown> }> }) => [{
      source: options.sources[0],
      result: {
        data: [{ symbol: "510300.SH", date: "20260724", close: 4.12 }],
        fresh: true,
      },
      toolCallId: "tool-price",
      skillRunId: "skill-price",
      marketSnapshotIds: ["market-price"],
    }]);

    const prices = await fetchScenarioInstrumentPrices([{
      id: "510300.SH",
      symbol: "510300.SH",
      market: "SH",
      asset_type: "fund",
      sector: "Broad Market",
    }], "analysis-price", execute as never);

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0].sources[0]).toMatchObject({
      method: "get_fund_daily",
      parameters: expect.objectContaining({ symbol: ["510300.SH"] }),
    });
    expect(prices).toEqual({ "510300.SH": "4.12" });
  });

  it("keeps valid model options when another option cannot be normalized", () => {
    const result = normalizeValidScenarioOptions([
      { ...baseOption, label: "A · 保持观察", strategy: "HOLD", trades: [] },
      { ...baseOption, label: "B · 无价格标的", trades: [{ instrumentId: "missing", action: "BUY", quantity: "1" }] },
    ], {
      objective: "降低集中度",
      parentCash: "100",
      holdings: [{ instrumentId: "a", quantity: "2", marketValue: "200" }],
      allowedInstrumentIds: new Set(["a", "b"]),
      priceManifest: manifest,
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.label).toBe("A · 保持观察");
    expect(result.rejections).toEqual([expect.objectContaining({
      sequenceNo: 1,
      message: "SCENARIO_UNKNOWN_INSTRUMENT:missing",
    })]);
  });
});
