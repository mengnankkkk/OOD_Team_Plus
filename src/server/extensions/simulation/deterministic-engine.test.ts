import { describe, expect, it } from "vitest";

import { hashPriceManifest, type PriceManifest, type SimulationCandidate } from "./candidate-generator";
import { executeSimulation } from "./deterministic-engine";

describe("deterministic simulation engine", () => {
  it("applies a sale to the actual holding and conserves assets after fees", () => {
    const result = executeSimulation("100", [
      { instrumentId: "AAPL", quantity: "2", marketValue: "300", assetType: "STOCK", sector: "TECH" },
      { instrumentId: "MSFT", quantity: "1", marketValue: "200", assetType: "STOCK", sector: "TECH" },
    ], candidate([{ instrumentId: "AAPL", action: "SELL", quantity: "0.5", price: "150" }]), manifest({ AAPL: "150", MSFT: "200" }));
    expect(result.holdings.find((item) => item.instrumentId === "AAPL")?.quantity).toBe("1.5");
    expect(result.newCashDecimal).toBe("174.925");
    expect(result.newTotalMarketValue).toBe("425");
    expect(result.tradingFees).toBe("0.075");
    expect(result.metrics.assetConservationDelta).toBe("0");
  });

  it("rejects overselling and negative simulated inventory", () => {
    expect(() => executeSimulation("0", [
      { instrumentId: "AAPL", quantity: "1", marketValue: "150" },
    ], candidate([{ instrumentId: "AAPL", action: "SELL", quantity: "1.00000001" }]), manifest({ AAPL: "150" }))).toThrow("INSUFFICIENT_SIMULATED_HOLDING");
  });

  it("rejects trade price overrides and missing frozen prices", () => {
    expect(() => executeSimulation("1000", [], candidate([
      { instrumentId: "AAPL", action: "BUY", quantity: "1", price: "149" },
    ]), manifest({ AAPL: "150" }))).toThrow("TRADE_PRICE_NOT_FROZEN");
    expect(() => executeSimulation("1000", [], candidate([
      { instrumentId: "UNKNOWN", action: "BUY", quantity: "1" },
    ]), manifest({ AAPL: "150" }))).toThrow("MISSING_FROZEN_PRICE");
  });

  it("rejects a modified manifest hash", () => {
    const frozen = manifest({ AAPL: "150" });
    frozen.prices.AAPL = "151";
    expect(() => executeSimulation("0", [{ instrumentId: "AAPL", quantity: "1", marketValue: "150" }], candidate([]), frozen)).toThrow("PRICE_MANIFEST_HASH_MISMATCH");
  });
});

function manifest(prices: Record<string, string>): PriceManifest {
  const value: PriceManifest = { prices, feeRate: "0.001", assets: {}, capturedAt: "2026-07-24T00:00:00.000Z", sha256: "" };
  value.sha256 = hashPriceManifest(value);
  return value;
}

function candidate(trades: SimulationCandidate["trades"]): SimulationCandidate {
  return {
    sequenceNo: 1,
    label: "Test",
    description: "Test",
    trades,
    targetAllocations: [],
    tradeIntent: "test",
    analysis: {
      strategy: "BALANCED",
      riskLevel: "MEDIUM",
      forecast: { expectedReturn: 0, bullCaseReturn: 0, bearCaseReturn: 0, annualVolatility: null, maxDrawdown: 0, concentrationHHI: 0 },
      rationale: [], counterEvidence: [], risks: [], assumptions: [], stressTests: [],
    },
  };
}
