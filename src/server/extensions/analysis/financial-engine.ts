import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const FINANCIAL_FORMULA_VERSION = "financial-engine-v1";
export const STRESS_PARAMETER_VERSION = "stress-cn-multi-asset-v1";

export type FinancialHolding = {
  instrumentId: string;
  assetType: string;
  sector?: string | null;
  quantity: string;
  price: string;
  cost?: string | null;
};

export type StressTestResult = {
  scenario: "BASE" | "EQUITY_DOWN_20" | "SECTOR_SHOCK" | "CONCENTRATION_SHOCK" | "LIQUIDITY_DISCOUNT" | "BULL" | "BEAR";
  changeAmount: string;
  changeRatio: string;
  assumptions: string[];
  parameterVersion: string;
};

export function calculatePortfolioMetrics(cashValue: string, holdings: FinancialHolding[]) {
  const cash = nonNegative(cashValue, "cashValue");
  const items = holdings.map((holding) => {
    const quantity = nonNegative(holding.quantity, `quantity:${holding.instrumentId}`);
    const price = positive(holding.price, `price:${holding.instrumentId}`);
    const marketValue = quantity.mul(price);
    const cost = holding.cost == null ? null : nonNegative(holding.cost, `cost:${holding.instrumentId}`);
    const unrealizedPnl = cost == null ? null : price.minus(cost).mul(quantity);
    const unrealizedPnlRate = cost?.gt(0) ? price.div(cost).minus(1) : null;
    return { ...holding, quantityValue: quantity, priceValue: price, marketValue, unrealizedPnl, unrealizedPnlRate };
  });
  const totalMarketValue = sum(items.map((item) => item.marketValue));
  const totalAssets = cash.plus(totalMarketValue);
  const weighted = items.map((item) => ({
    ...item,
    weight: totalMarketValue.gt(0) ? item.marketValue.div(totalMarketValue) : new Decimal(0),
  }));
  const hhi = sum(weighted.map((item) => item.weight.pow(2)));
  const sortedWeights = weighted.map((item) => item.weight).sort((a, b) => b.comparedTo(a));
  const unrealizedPnl = sum(weighted.flatMap((item) => item.unrealizedPnl == null ? [] : [item.unrealizedPnl]));
  return {
    cashValue: clean(cash),
    totalMarketValue: clean(totalMarketValue),
    totalAssets: clean(totalAssets),
    unrealizedPnl: clean(unrealizedPnl),
    cashAllocation: clean(totalAssets.gt(0) ? cash.div(totalAssets) : new Decimal(0)),
    concentrationHhi: clean(hhi),
    largestPositionWeight: clean(sortedWeights[0] ?? new Decimal(0)),
    topThreeWeight: clean(sum(sortedWeights.slice(0, 3))),
    formulaVersion: FINANCIAL_FORMULA_VERSION,
    holdings: weighted.map((item) => ({
      instrumentId: item.instrumentId,
      assetType: item.assetType,
      sector: item.sector ?? null,
      quantity: clean(item.quantityValue),
      price: clean(item.priceValue),
      marketValue: clean(item.marketValue),
      weight: clean(item.weight),
      weightBps: item.weight.mul(10_000).toDecimalPlaces(0).toNumber(),
      unrealizedPnl: item.unrealizedPnl == null ? null : clean(item.unrealizedPnl),
      unrealizedPnlRate: item.unrealizedPnlRate == null ? null : clean(item.unrealizedPnlRate),
    })),
  };
}

export function calculateTechnicalIndicators(values: string[]) {
  const closes = values.map((value, index) => positive(value, `close:${index}`));
  const latest = closes.at(-1) ?? null;
  const ma20 = movingAverage(closes, 20);
  const ma60 = movingAverage(closes, 60);
  const rsi14 = rsi(closes, 14);
  const macd = macdValues(closes);
  const annualVolatility = volatility(closes);
  const maxDrawdown = drawdown(closes);
  const high52 = closes.slice(-252).reduce<Decimal | null>((peak, value) => peak == null ? value : Decimal.max(peak, value), null);
  const low52 = closes.slice(-252).reduce<Decimal | null>((low, value) => low == null ? value : Decimal.min(low, value), null);
  const position52Week = latest && high52 && low52 && high52.gt(low52) ? latest.minus(low52).div(high52.minus(low52)) : null;
  return {
    latest: latest ? clean(latest) : null,
    return20: periodReturn(closes, 20),
    return60: periodReturn(closes, 60),
    ma20: ma20 ? clean(ma20) : null,
    ma60: ma60 ? clean(ma60) : null,
    rsi14: rsi14 ? clean(rsi14) : null,
    macd: macd ? { line: clean(macd.line), signal: clean(macd.signal), histogram: clean(macd.histogram) } : null,
    annualVolatility: annualVolatility ? clean(annualVolatility) : null,
    maxDrawdown: maxDrawdown ? clean(maxDrawdown) : null,
    position52Week: position52Week ? clean(position52Week) : null,
    observationCount: closes.length,
    formulaVersion: FINANCIAL_FORMULA_VERSION,
    missing: [
      closes.length < 20 ? "MA20_REQUIRES_20_OBSERVATIONS" : null,
      closes.length < 60 ? "MA60_REQUIRES_60_OBSERVATIONS" : null,
      closes.length < 15 ? "RSI14_REQUIRES_15_OBSERVATIONS" : null,
      closes.length < 35 ? "MACD_REQUIRES_35_OBSERVATIONS" : null,
    ].filter((item): item is string => Boolean(item)),
  };
}

export function runPortfolioStressTests(cashValue: string, holdings: FinancialHolding[]): StressTestResult[] {
  const portfolio = calculatePortfolioMetrics(cashValue, holdings);
  const totalAssets = decimal(portfolio.totalAssets);
  const largestSector = largestGroup(portfolio.holdings, (item) => item.sector ?? "UNKNOWN");
  const largestHolding = [...portfolio.holdings].sort((a, b) => decimal(b.marketValue).comparedTo(decimal(a.marketValue)))[0]?.instrumentId;
  const scenarios: Array<{ scenario: StressTestResult["scenario"]; shock: (item: typeof portfolio.holdings[number]) => Decimal; assumptions: string[] }> = [
    { scenario: "BASE", shock: () => new Decimal(0), assumptions: ["冻结价格清单作为基准，不假设收益"] },
    { scenario: "EQUITY_DOWN_20", shock: (item) => equityShock(item.assetType), assumptions: ["股票 -20%，股票型基金/指数 -15%，黄金 -3%，债券 -4%"] },
    { scenario: "SECTOR_SHOCK", shock: (item) => item.sector === largestSector ? new Decimal("-0.25") : new Decimal("-0.03"), assumptions: [`最大行业 ${largestSector ?? "UNKNOWN"} -25%，其他风险资产 -3%`] },
    { scenario: "CONCENTRATION_SHOCK", shock: (item) => item.instrumentId === largestHolding ? new Decimal("-0.30") : new Decimal(0), assumptions: ["最大单一持仓 -30%，其他资产不变"] },
    { scenario: "LIQUIDITY_DISCOUNT", shock: (item) => liquidityShock(item.assetType), assumptions: ["按资产类型施加流动性折价，不包含真实成交冲击模型"] },
    { scenario: "BULL", shock: (item) => bullShock(item.assetType), assumptions: ["权益 +15%，基金/指数 +12%，黄金 +5%，债券 +3%"] },
    { scenario: "BEAR", shock: (item) => bearShock(item.assetType), assumptions: ["权益 -25%，基金/指数 -20%，黄金 +4%，债券 -6%"] },
  ];
  return scenarios.map(({ scenario, shock, assumptions }) => {
    const changeAmount = sum(portfolio.holdings.map((item) => decimal(item.marketValue).mul(shock(item))));
    return {
      scenario,
      changeAmount: clean(changeAmount),
      changeRatio: clean(totalAssets.gt(0) ? changeAmount.div(totalAssets) : new Decimal(0)),
      assumptions,
      parameterVersion: STRESS_PARAMETER_VERSION,
    };
  });
}

function equityShock(assetType: string): Decimal {
  const type = assetType.toUpperCase();
  if (type.includes("GOLD")) return new Decimal("-0.03");
  if (type.includes("BOND") || type.includes("CASH")) return new Decimal("-0.04");
  if (type.includes("FUND") || type.includes("ETF") || type.includes("INDEX")) return new Decimal("-0.15");
  return new Decimal("-0.20");
}

function bullShock(assetType: string): Decimal {
  const type = assetType.toUpperCase();
  if (type.includes("GOLD")) return new Decimal("0.05");
  if (type.includes("BOND") || type.includes("CASH")) return new Decimal("0.03");
  if (type.includes("FUND") || type.includes("ETF") || type.includes("INDEX")) return new Decimal("0.12");
  return new Decimal("0.15");
}

function bearShock(assetType: string): Decimal {
  const type = assetType.toUpperCase();
  if (type.includes("GOLD")) return new Decimal("0.04");
  if (type.includes("BOND") || type.includes("CASH")) return new Decimal("-0.06");
  if (type.includes("FUND") || type.includes("ETF") || type.includes("INDEX")) return new Decimal("-0.20");
  return new Decimal("-0.25");
}

function liquidityShock(assetType: string): Decimal {
  const type = assetType.toUpperCase();
  if (type.includes("CASH")) return new Decimal(0);
  if (type.includes("INDEX") || type.includes("ETF")) return new Decimal("-0.005");
  if (type.includes("FUND") || type.includes("BOND") || type.includes("GOLD")) return new Decimal("-0.01");
  return new Decimal("-0.03");
}

function largestGroup<T>(items: T[], key: (item: T) => string): string | null {
  const values = new Map<string, Decimal>();
  for (const item of items) values.set(key(item), (values.get(key(item)) ?? new Decimal(0)).plus(decimal((item as { marketValue: string }).marketValue)));
  return [...values.entries()].sort((a, b) => b[1].comparedTo(a[1]))[0]?.[0] ?? null;
}

function movingAverage(values: Decimal[], period: number): Decimal | null {
  return values.length < period ? null : sum(values.slice(-period)).div(period);
}

function periodReturn(values: Decimal[], period: number): string | null {
  if (values.length <= period) return null;
  return clean(values.at(-1)!.div(values.at(-(period + 1))!).minus(1));
}

function volatility(values: Decimal[]): Decimal | null {
  const returns = values.slice(1).map((value, index) => value.div(values[index]).minus(1));
  if (returns.length < 2) return null;
  const mean = sum(returns).div(returns.length);
  return sum(returns.map((value) => value.minus(mean).pow(2))).div(returns.length - 1).sqrt().mul(new Decimal(252).sqrt());
}

function drawdown(values: Decimal[]): Decimal | null {
  if (!values.length) return null;
  let peak = values[0];
  let worst = new Decimal(0);
  for (const value of values) {
    peak = Decimal.max(peak, value);
    if (peak.gt(0)) worst = Decimal.min(worst, value.div(peak).minus(1));
  }
  return worst;
}

function rsi(values: Decimal[], period: number): Decimal | null {
  if (values.length <= period) return null;
  const changes = values.slice(-period - 1).slice(1).map((value, index) => value.minus(values.slice(-period - 1)[index]));
  const gains = sum(changes.map((value) => Decimal.max(0, value))).div(period);
  const losses = sum(changes.map((value) => Decimal.max(0, value.neg()))).div(period);
  if (losses.eq(0)) return gains.eq(0) ? new Decimal(50) : new Decimal(100);
  return new Decimal(100).minus(new Decimal(100).div(new Decimal(1).plus(gains.div(losses))));
}

function macdValues(values: Decimal[]): { line: Decimal; signal: Decimal; histogram: Decimal } | null {
  if (values.length < 35) return null;
  const fast = emaSeries(values, 12);
  const slow = emaSeries(values, 26);
  const lineSeries = values.map((_, index) => fast[index].minus(slow[index]));
  const signalSeries = emaSeries(lineSeries, 9);
  const line = lineSeries.at(-1)!;
  const signal = signalSeries.at(-1)!;
  return { line, signal, histogram: line.minus(signal) };
}

function emaSeries(values: Decimal[], period: number): Decimal[] {
  const multiplier = new Decimal(2).div(period + 1);
  const output: Decimal[] = [values[0]];
  for (const value of values.slice(1)) output.push(value.minus(output.at(-1)!).mul(multiplier).plus(output.at(-1)!));
  return output;
}

function sum(values: Decimal[]): Decimal {
  return values.reduce((total, value) => total.plus(value), new Decimal(0));
}

function decimal(value: string): Decimal {
  const result = new Decimal(value);
  if (!result.isFinite()) throw new Error("INVALID_FINANCIAL_DECIMAL");
  return result;
}

function positive(value: string, field: string): Decimal {
  const result = decimal(value);
  if (!result.gt(0)) throw new Error(`INVALID_POSITIVE_DECIMAL:${field}`);
  return result;
}

function nonNegative(value: string, field: string): Decimal {
  const result = decimal(value);
  if (result.isNegative()) throw new Error(`INVALID_NON_NEGATIVE_DECIMAL:${field}`);
  return result;
}

function clean(value: Decimal): string {
  return value.toDecimalPlaces(12).toFixed().replace(/\.0+$/u, "").replace(/(\.\d*?)0+$/u, "$1");
}
