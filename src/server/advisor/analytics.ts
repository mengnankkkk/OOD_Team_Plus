import { minorToMoney, multiplyToMinor, ratio, roundDecimal } from "@/server/advisor/decimal";

export type PriceRow = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

export function normalizePrices(rows: Array<Record<string, unknown>>): PriceRow[] {
  return rows
    .map((row) => ({
      date: String(row.date ?? row.trade_date ?? ""),
      close: Number(row.close ?? row.close_price ?? row.price ?? 0),
      high: row.high == null ? undefined : Number(row.high),
      low: row.low == null ? undefined : Number(row.low),
      volume: row.volume == null ? undefined : Number(row.volume),
    }))
    .filter((row) => row.date && Number.isFinite(row.close) && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function calculateTechnical(rows: PriceRow[]) {
  const closes = rows.map((row) => row.close);
  const last = closes.at(-1) ?? 0;
  const ma20 = average(closes.slice(-20));
  const ma60 = average(closes.slice(-60));
  const ma120 = average(closes.slice(-120));
  const peak = Math.max(...closes.slice(-120), last);
  const drawdown = peak ? last / peak - 1 : 0;
  const volatility20d = stdev(returns(closes.slice(-21))) * Math.sqrt(252);
  const rsi14 = calculateRsi(closes.slice(-15));
  const macd = calculateMacd(closes);
  return {
    lastPrice: roundDecimal(last),
    ma20: roundDecimal(ma20),
    ma60: roundDecimal(ma60),
    ma120: roundDecimal(ma120),
    ma20Relation: last >= ma20 ? "ABOVE" : "BELOW",
    ma60Relation: last >= ma60 ? "ABOVE" : "BELOW",
    ma120Relation: last >= ma120 ? "ABOVE" : "BELOW",
    currentDrawdown: roundDecimal(drawdown),
    volatility20d: roundDecimal(volatility20d),
    rsi14: roundDecimal(rsi14, 1),
    macdState: macd.histogram > 0 && macd.prevHistogram <= 0 ? "DAILY_GOLDEN_CROSS" : macd.histogram >= 0 ? "BULLISH" : "BEARISH",
    macdZeroAxis: macd.dif >= 0 ? "ABOVE" : "BELOW",
    macdCrossDate: rows.at(-1)?.date,
  };
}

export function holdingMetrics(input: {
  quantity: string;
  averageCost: string;
  lastPrice: string;
  portfolioTotalMinor?: number;
  drawdown?: number;
}) {
  const marketValueMinor = multiplyToMinor(input.lastPrice, input.quantity);
  const costValueMinor = multiplyToMinor(input.averageCost, input.quantity);
  const pnlMinor = marketValueMinor - costValueMinor;
  return {
    marketValue: minorToMoney(marketValueMinor),
    costValue: minorToMoney(costValueMinor),
    unrealizedPnl: minorToMoney(pnlMinor),
    unrealizedPnlRatio: roundDecimal(ratio(pnlMinor, costValueMinor)),
    portfolioWeight: roundDecimal(ratio(marketValueMinor, input.portfolioTotalMinor ?? marketValueMinor)),
    currentDrawdown: roundDecimal(input.drawdown ?? 0),
    marketValueMinor,
    costValueMinor,
    pnlMinor,
  };
}

export function concentration(holdings: Array<{ valueMinor: number; category: string; sector?: string | null }>) {
  const total = holdings.reduce((sum, item) => sum + item.valueMinor, 0);
  const invested = holdings.filter((item) => item.category !== "CASH");
  const weights = invested.map((item) => ratio(item.valueMinor, total)).sort((a, b) => b - a);
  const sectorWeights = groupWeight(invested, (item) => item.sector ?? item.category, total);
  const categoryWeights = groupWeight(holdings, (item) => item.category, total);
  return {
    totalValueMinor: total,
    largestPositionWeight: roundDecimal(weights[0] ?? 0),
    topThreeWeight: roundDecimal(weights.slice(0, 3).reduce((sum, value) => sum + value, 0)),
    largestSectorWeight: roundDecimal(Math.max(0, ...Object.values(sectorWeights))),
    sectorWeights,
    categoryWeights,
  };
}

export function stressLoss(categoryWeights: Record<string, number>) {
  const equity = (categoryWeights.STOCK ?? 0) + (categoryWeights.ETF ?? 0) + (categoryWeights.INDEX_FUND ?? 0);
  const gold = (categoryWeights.GOLD_ETF ?? 0) + (categoryWeights.GOLD ?? 0);
  return roundDecimal(equity * -0.2 + gold * -0.08 + (categoryWeights.CASH ?? 0) * 0);
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function returns(values: number[]) {
  return values.slice(1).map((value, index) => value / values[index] - 1);
}

function stdev(values: number[]) {
  if (values.length === 0) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function calculateRsi(values: number[]) {
  if (values.length < 2) return 50;
  const changes = values.slice(1).map((value, index) => value - values[index]);
  const gains = changes.filter((value) => value > 0);
  const losses = changes.filter((value) => value < 0).map(Math.abs);
  const avgLoss = average(losses);
  if (avgLoss === 0) return 100;
  const rs = average(gains) / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calculateMacd(values: number[]) {
  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);
  const difSeries = values.map((_, index) => ema(values.slice(0, index + 1), 12) - ema(values.slice(0, index + 1), 26));
  const dea = ema(difSeries, 9);
  const prevDea = ema(difSeries.slice(0, -1), 9);
  const dif = ema12 - ema26;
  return { dif, dea, histogram: dif - dea, prevHistogram: (difSeries.at(-2) ?? 0) - prevDea };
}

function ema(values: number[], period: number) {
  if (values.length === 0) return 0;
  const alpha = 2 / (period + 1);
  return values.slice(1).reduce((prev, value) => value * alpha + prev * (1 - alpha), values[0]);
}

function groupWeight<T>(items: T[], key: (item: T) => string, total: number) {
  const grouped: Record<string, number> = {};
  for (const item of items) grouped[key(item)] = (grouped[key(item)] ?? 0) + (item as { valueMinor: number }).valueMinor;
  return Object.fromEntries(Object.entries(grouped).map(([name, value]) => [name, roundDecimal(ratio(value, total))]));
}
