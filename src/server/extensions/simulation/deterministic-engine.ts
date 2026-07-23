import type { PriceManifest, SimulationCandidate } from "./candidate-generator";

export interface SimulationMetrics {
  totalReturn: number;
  maxDrawdown: number;
  volatility: number;
  concentrationHHI: number;
}

export interface SimulationResult {
  newCashDecimal: string;
  newTotalMarketValue: string;
  holdings: Array<{
    instrumentId: string;
    quantity: string;
    price: string;
    marketValue: string;
    weightBps: number;
  }>;
  tradingFees: string;
  metrics: SimulationMetrics;
}

/**
 * Pure Wave 6 stub. It returns the parent state and never touches real holdings.
 */
export function executeSimulation(
  parentCashDecimal: string,
  parentHoldings: Array<{ instrumentId: string; quantity: string; marketValue: string }>,
  candidate: SimulationCandidate,
  priceManifest: PriceManifest,
): SimulationResult {
  void candidate;
  const totalMarketValue = parentHoldings.reduce(
    (sum, holding) => sum + Number.parseFloat(holding.marketValue),
    0,
  );

  return {
    newCashDecimal: parentCashDecimal,
    newTotalMarketValue: totalMarketValue.toString(),
    holdings: parentHoldings.map((holding) => ({
      instrumentId: holding.instrumentId,
      quantity: holding.quantity,
      price: priceManifest.prices[holding.instrumentId] ?? "0",
      marketValue: holding.marketValue,
      weightBps: Math.round(
        (Number.parseFloat(holding.marketValue) / Math.max(totalMarketValue, 1)) * 10_000,
      ),
    })),
    tradingFees: "0",
    metrics: {
      totalReturn: 0,
      maxDrawdown: 0,
      volatility: 0,
      concentrationHHI: 0,
    },
  };
}
