import Decimal from "decimal.js";

import { calculatePortfolioMetrics, FINANCIAL_FORMULA_VERSION, runPortfolioStressTests, type StressTestResult } from "@/server/extensions/analysis/financial-engine";

import { hashPriceManifest, type PriceManifest, type SimulationCandidate } from "./candidate-generator";

export interface SimulationMetrics {
  totalReturn: number;
  maxDrawdown: number;
  volatility: number | null;
  concentrationHHI: number;
  expectedReturn: number;
  bullCaseReturn: number;
  bearCaseReturn: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  stressTests: StressTestResult[];
  missingMetrics: string[];
  formulaVersion: string;
  assetConservationDelta: string;
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

type ParentHolding = { instrumentId: string; quantity: string; marketValue: string; assetType?: string; sector?: string | null };

export function executeSimulation(
  parentCashDecimal: string,
  parentHoldings: ParentHolding[],
  candidate: SimulationCandidate,
  priceManifest: PriceManifest,
): SimulationResult {
  if (hashPriceManifest(priceManifest) !== priceManifest.sha256) throw new Error("PRICE_MANIFEST_HASH_MISMATCH");
  const feeRate = nonNegative(priceManifest.feeRate ?? "0.001", "feeRate");
  const parentCash = nonNegative(parentCashDecimal, "parentCash");
  const states = new Map(parentHoldings.map((holding) => {
    const quantity = nonNegative(holding.quantity, `quantity:${holding.instrumentId}`);
    assertQuantityPrecision(quantity, holding.instrumentId);
    return [holding.instrumentId, {
      quantity,
      assetType: holding.assetType ?? priceManifest.assets?.[holding.instrumentId]?.assetType ?? "UNKNOWN",
      sector: holding.sector ?? priceManifest.assets?.[holding.instrumentId]?.sector ?? null,
    }];
  }));
  const parentMarketValue = sum(parentHoldings.map((holding) => {
    const price = manifestPrice(priceManifest, holding.instrumentId);
    return nonNegative(holding.quantity, `quantity:${holding.instrumentId}`).mul(price);
  }));
  const parentTotalAssets = parentCash.plus(parentMarketValue);
  let cash = parentCash;
  let fees = new Decimal(0);

  for (const trade of candidate.trades) {
    const quantity = positive(trade.quantity, `tradeQuantity:${trade.instrumentId}`);
    assertQuantityPrecision(quantity, trade.instrumentId);
    const price = manifestPrice(priceManifest, trade.instrumentId);
    if (trade.price != null && !decimal(trade.price, `tradePrice:${trade.instrumentId}`).eq(price)) throw new Error("TRADE_PRICE_NOT_FROZEN");
    const notional = quantity.mul(price);
    const fee = notional.mul(feeRate);
    const state = states.get(trade.instrumentId) ?? {
      quantity: new Decimal(0),
      assetType: priceManifest.assets?.[trade.instrumentId]?.assetType ?? "UNKNOWN",
      sector: priceManifest.assets?.[trade.instrumentId]?.sector ?? null,
    };
    if (trade.action === "BUY") {
      const requiredCash = notional.plus(fee);
      if (cash.lt(requiredCash)) throw new Error("INSUFFICIENT_SIMULATED_CASH");
      cash = cash.minus(requiredCash);
      state.quantity = state.quantity.plus(quantity);
    } else {
      if (state.quantity.lt(quantity)) throw new Error("INSUFFICIENT_SIMULATED_HOLDING");
      cash = cash.plus(notional.minus(fee));
      state.quantity = state.quantity.minus(quantity);
    }
    if (cash.isNegative() || state.quantity.isNegative()) throw new Error("NEGATIVE_SIMULATED_ASSET");
    states.set(trade.instrumentId, state);
    fees = fees.plus(fee);
  }

  const financialHoldings = [...states.entries()]
    .filter(([, state]) => state.quantity.gt(0))
    .map(([instrumentId, state]) => ({
      instrumentId,
      assetType: state.assetType,
      sector: state.sector,
      quantity: clean(state.quantity),
      price: clean(manifestPrice(priceManifest, instrumentId)),
    }));
  const portfolio = calculatePortfolioMetrics(clean(cash), financialHoldings);
  const totalAssets = decimal(portfolio.totalAssets, "totalAssets");
  const expectedAssets = parentTotalAssets.minus(fees);
  const conservationDelta = totalAssets.minus(expectedAssets);
  if (!conservationDelta.eq(0)) throw new Error(`SIMULATION_ASSET_CONSERVATION_FAILED:${clean(conservationDelta)}`);

  const stressTests = runPortfolioStressTests(clean(cash), financialHoldings);
  const bull = stressTests.find((item) => item.scenario === "BULL")!;
  const bear = stressTests.find((item) => item.scenario === "BEAR")!;
  const worst = stressTests.reduce((current, item) => Decimal.min(current, decimal(item.changeRatio, item.scenario)), new Decimal(0));
  const lossMagnitude = worst.abs();
  const riskLevel = lossMagnitude.gt("0.2") ? "HIGH" : lossMagnitude.gt("0.1") ? "MEDIUM" : "LOW";
  const totalReturn = parentTotalAssets.gt(0) ? totalAssets.div(parentTotalAssets).minus(1) : new Decimal(0);

  return {
    newCashDecimal: clean(cash),
    newTotalMarketValue: portfolio.totalMarketValue,
    holdings: portfolio.holdings.map((holding) => ({
      instrumentId: holding.instrumentId,
      quantity: holding.quantity,
      price: holding.price,
      marketValue: holding.marketValue,
      weightBps: holding.weightBps,
    })),
    tradingFees: clean(fees),
    metrics: {
      totalReturn: totalReturn.toNumber(),
      maxDrawdown: worst.toNumber(),
      volatility: null,
      concentrationHHI: decimal(portfolio.concentrationHhi, "concentrationHhi").toNumber(),
      expectedReturn: 0,
      bullCaseReturn: decimal(bull.changeRatio, "bullCaseReturn").toNumber(),
      bearCaseReturn: decimal(bear.changeRatio, "bearCaseReturn").toNumber(),
      riskLevel,
      stressTests,
      missingMetrics: ["ANNUAL_VOLATILITY_REQUIRES_HISTORICAL_SERIES"],
      formulaVersion: FINANCIAL_FORMULA_VERSION,
      assetConservationDelta: clean(conservationDelta),
    },
  };
}

function manifestPrice(manifest: PriceManifest, instrumentId: string): Decimal {
  const value = manifest.prices[instrumentId];
  if (value == null) throw new Error(`MISSING_FROZEN_PRICE:${instrumentId}`);
  return positive(value, `manifestPrice:${instrumentId}`);
}

function assertQuantityPrecision(value: Decimal, instrumentId: string): void {
  if (value.decimalPlaces() > 8) throw new Error(`QUANTITY_PRECISION_EXCEEDED:${instrumentId}`);
}

function decimal(value: string, field: string): Decimal {
  try {
    const result = new Decimal(value);
    if (!result.isFinite()) throw new Error();
    return result;
  } catch {
    throw new Error(`INVALID_DECIMAL:${field}`);
  }
}

function positive(value: string, field: string): Decimal {
  const result = decimal(value, field);
  if (!result.gt(0)) throw new Error(`INVALID_POSITIVE_DECIMAL:${field}`);
  return result;
}

function nonNegative(value: string, field: string): Decimal {
  const result = decimal(value, field);
  if (result.isNegative()) throw new Error(`INVALID_NON_NEGATIVE_DECIMAL:${field}`);
  return result;
}

function sum(values: Decimal[]): Decimal {
  return values.reduce((total, value) => total.plus(value), new Decimal(0));
}

function clean(value: Decimal): string {
  return value.toDecimalPlaces(12).toFixed().replace(/\.0+$/u, "").replace(/(\.\d*?)0+$/u, "$1");
}
