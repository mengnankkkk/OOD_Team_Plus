import type { PriceManifest, SimulationCandidate } from "./candidate-generator";

export interface SimulationMetrics {
  totalReturn: number;
  maxDrawdown: number;
  volatility: number;
  concentrationHHI: number;
  expectedReturn: number;
  bullCaseReturn: number;
  bearCaseReturn: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
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

export function executeSimulation(
  parentCashDecimal: string,
  parentHoldings: Array<{ instrumentId: string; quantity: string; marketValue: string }>,
  candidate: SimulationCandidate,
  priceManifest: PriceManifest,
): SimulationResult {
  const feeRate = 0.001;
  const cash = Number(parentCashDecimal);
  const states = new Map(parentHoldings.map((holding) => [holding.instrumentId, {
    quantity: Number(holding.quantity),
    marketValue: Number(holding.marketValue),
  }]));
  let newCash = Number.isFinite(cash) ? cash : 0;
  let fees = 0;
  let tradedNotional = 0;

  for (const trade of candidate.trades) {
    const quantity = Number(trade.quantity);
    const price = Number(trade.price ?? priceManifest.prices[trade.instrumentId]);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) continue;
    const notional = quantity * price;
    const fee = notional * feeRate;
    const state = states.get(trade.instrumentId) ?? { quantity: 0, marketValue: 0 };
    if (trade.action === "BUY") {
      if (newCash < notional + fee) throw new Error("INSUFFICIENT_SIMULATED_CASH");
      newCash -= notional + fee;
      state.quantity += quantity;
    } else {
      if (state.quantity + 1e-9 < quantity) throw new Error("INSUFFICIENT_SIMULATED_HOLDING");
      newCash += notional - fee;
      state.quantity -= quantity;
    }
    state.marketValue = state.quantity * price;
    states.set(trade.instrumentId, state);
    fees += fee;
    tradedNotional += notional;
  }

  const holdings = [...states.entries()]
    .map(([instrumentId, state]) => ({ instrumentId, quantity: state.quantity, price: Number(priceManifest.prices[instrumentId] ?? 0), marketValue: state.quantity * Number(priceManifest.prices[instrumentId] ?? 0) }))
    .filter((holding) => holding.quantity > 1e-9 && holding.price > 0);
  const totalMarketValue = holdings.reduce((sum, holding) => sum + holding.marketValue, 0);
  const parentValue = parentHoldings.reduce((sum, holding) => sum + Number(holding.marketValue), 0);
  const totalValue = newCash + totalMarketValue;
  const weights = holdings.map((holding) => totalMarketValue > 0 ? holding.marketValue / totalMarketValue : 0);
  const hhi = weights.reduce((sum, weight) => sum + weight * weight, 0);
  const concentration = weights.length ? hhi : 0;
  const totalReturn = parentValue + cash > 0 ? ((totalValue - (parentValue + cash)) / (parentValue + cash)) : 0;
  const turnover = parentValue > 0 ? tradedNotional / parentValue : 0;

  return {
    newCashDecimal: fixed(newCash),
    newTotalMarketValue: fixed(totalMarketValue),
    holdings: holdings.map((holding) => ({
      instrumentId: holding.instrumentId,
      quantity: fixed(holding.quantity),
      price: fixed(holding.price),
      marketValue: fixed(holding.marketValue),
      weightBps: Math.round((holding.marketValue / Math.max(totalMarketValue, 1)) * 10_000),
    })),
    tradingFees: fixed(fees),
    metrics: {
      totalReturn,
      maxDrawdown: candidate.analysis?.forecast.maxDrawdown ?? Math.min(0, -turnover * 0.02),
      volatility: candidate.analysis?.forecast.annualVolatility ?? Math.min(1, 0.08 + concentration * 0.25 + turnover * 0.05),
      concentrationHHI: concentration,
      expectedReturn: candidate.analysis?.forecast.expectedReturn ?? 0,
      bullCaseReturn: candidate.analysis?.forecast.bullCaseReturn ?? 0,
      bearCaseReturn: candidate.analysis?.forecast.bearCaseReturn ?? 0,
      riskLevel: candidate.analysis?.riskLevel ?? "MEDIUM",
    },
  };
}

function fixed(value: number): string {
  return (Number.isFinite(value) ? value : 0).toFixed(8).replace(/0+$/u, "").replace(/\.$/u, "") || "0";
}
