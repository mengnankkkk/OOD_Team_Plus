import { parseJson, type getDatabase } from "@/server/http/context";

import type { MarketAggregate, RiskAggregate } from "./types";

type Db = ReturnType<typeof getDatabase>;
export type InstrumentRow = {
  id: string;
  symbol: string;
  name: string;
  market: string;
  asset_type: string;
  sector: string | null;
};
export type MarketPoint = {
  date: string;
  close: number;
  previousClose: number | null;
  dataAsOf?: string;
  freshnessStatus?: string;
};

type SnapshotRow = {
  as_of: string;
  trading_date: string | null;
  freshness_status: string;
  raw_payload_json: string | null;
};

export function readMarketAggregate(db: Db, instrument: InstrumentRow): MarketAggregate {
  const points = readMarketPoints(db, instrument.id);
  const latest = points.at(-1);
  if (!latest) return unavailableMarket();
  const previousClose = latest.previousClose ?? points.at(-2)?.close ?? null;
  return {
    price: latest.close,
    previousClose,
    dailyMovePct: previousClose && previousClose > 0 ? latest.close / previousClose - 1 : null,
    dataAsOf: latest.dataAsOf ?? latest.date,
    status: marketAvailability(latest),
  };
}

export function readMarketPoints(db: Db, instrumentId: string): MarketPoint[] {
  const rows = db.prepare(`SELECT as_of,trading_date,freshness_status,raw_payload_json
    FROM market_snapshots
    WHERE instrument_id = ? AND lower(quality_status) = 'valid' AND raw_payload_json IS NOT NULL
    ORDER BY COALESCE(trading_date,as_of) DESC,as_of DESC,created_at DESC LIMIT 200`)
    .all(instrumentId) as SnapshotRow[];
  const byDate = new Map<string, MarketPoint>();
  for (const row of rows) {
    const payload = parseJson<Record<string, unknown>>(row.raw_payload_json, {});
    const close = finiteNumber(payload.close ?? payload.price ?? payload.nav);
    const date = normalizeDate(payload.date ?? payload.trade_date ?? row.trading_date ?? row.as_of);
    if (!date || close === null || close <= 0 || byDate.has(date)) continue;
    byDate.set(date, {
      date,
      close,
      previousClose: finiteNumber(payload.pre_close ?? payload.previous_close ?? payload.prev_close),
      dataAsOf: row.as_of,
      freshnessStatus: row.freshness_status,
    });
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date)).slice(-40);
}

export function computeRiskAggregate(points: MarketPoint[]): RiskAggregate {
  const valid = normalizePoints(points);
  if (valid.length < 20) return unavailableRisk();
  const recentVolatility = annualizedVolatility(valid.slice(-10));
  const previousVolatility = annualizedVolatility(valid.slice(-20, -10));
  const recentDrawdown = maximumDrawdown(valid.slice(-20));
  const previousDrawdown = valid.length >= 40 ? maximumDrawdown(valid.slice(-40, -20)) : null;
  if (recentVolatility === null || previousVolatility === null) return unavailableRisk();
  const volatilityDelta = previousVolatility > 0 ? recentVolatility / previousVolatility - 1 : 0;
  const drawdownDelta = previousDrawdown && previousDrawdown > 0
    ? recentDrawdown / previousDrawdown - 1
    : 0;
  let status: RiskAggregate["status"] = "stable";
  if (volatilityDelta >= 0.25 || drawdownDelta >= 0.25) status = "increasing";
  else if (
    (volatilityDelta <= -0.2 || drawdownDelta <= -0.2)
    && volatilityDelta < 0.25
    && drawdownDelta < 0.25
  ) status = "decreasing";
  return {
    status,
    recentVolatility,
    previousVolatility,
    recentDrawdown,
    previousDrawdown,
    dataAsOf: valid.at(-1)?.dataAsOf ?? valid.at(-1)?.date ?? null,
  };
}

function normalizePoints(points: MarketPoint[]): MarketPoint[] {
  const byDate = new Map<string, MarketPoint>();
  for (const point of [...points].sort((left, right) => left.date.localeCompare(right.date))) {
    if (point.date && Number.isFinite(point.close) && point.close > 0) byDate.set(point.date, point);
  }
  return [...byDate.values()].slice(-40);
}

function annualizedVolatility(points: MarketPoint[]): number | null {
  if (points.length < 2) return null;
  const returns = points.slice(1).map((point, index) => point.close / points[index].close - 1);
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(252);
}

function maximumDrawdown(points: MarketPoint[]): number {
  let peak = points[0]?.close ?? 0;
  let maximum = 0;
  for (const point of points) {
    peak = Math.max(peak, point.close);
    if (peak > 0) maximum = Math.max(maximum, (peak - point.close) / peak);
  }
  return maximum;
}

function marketAvailability(point: MarketPoint): MarketAggregate["status"] {
  if (point.freshnessStatus?.toLowerCase() === "stale") return "stale";
  const observedAt = Date.parse(point.dataAsOf ?? point.date);
  if (!Number.isFinite(observedAt)) return "available";
  const age = Date.now() - observedAt;
  if (age <= 72 * 60 * 60 * 1000 || weekendGrace(observedAt, age)) return "available";
  return "stale";
}

function weekendGrace(observedAt: number, age: number): boolean {
  const observedDay = new Date(observedAt).getUTCDay();
  const currentDay = new Date().getUTCDay();
  return age <= 120 * 60 * 60 * 1000 && observedDay === 5 && (currentDay === 0 || currentDay === 1);
}

function normalizeDate(value: unknown): string | null {
  const text = String(value ?? "").trim();
  const digits = text.replace(/\D/gu, "").slice(0, 8);
  return digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}` : null;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function unavailableMarket(): MarketAggregate {
  return { price: null, previousClose: null, dailyMovePct: null, dataAsOf: null, status: "insufficient_data" };
}

function unavailableRisk(): RiskAggregate {
  return {
    status: "insufficient_data",
    recentVolatility: null,
    previousVolatility: null,
    recentDrawdown: null,
    previousDrawdown: null,
    dataAsOf: null,
  };
}
