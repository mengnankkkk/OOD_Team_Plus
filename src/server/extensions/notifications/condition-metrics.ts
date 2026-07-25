import Decimal from "decimal.js";

import { parseJson } from "@/server/http/context";

import type { ObservationConditionType } from "./condition-contract";

export type ConditionRow = Record<string, unknown> & {
  condition_type: ObservationConditionType;
  id: string;
  instrument_id: string | null;
  user_id: string;
};

export type ObservedMetric = {
  value: Decimal | null;
  dataAsOf: string | null;
  metricSnapshot: Record<string, unknown>;
};

type Db = {
  prepare: (sql: string) => {
    get: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
  };
};

type MarketPoint = { close: Decimal; date: string; previousClose: Decimal | null };

export function readObservedMetric(db: Db, condition: ConditionRow): ObservedMetric {
  if (condition.condition_type === "REVIEW_DATE") {
    const date = shanghaiDate();
    return { value: new Decimal(1), dataAsOf: date, metricSnapshot: { calendarDate: date } };
  }
  if (!condition.instrument_id) return insufficient();
  if (condition.condition_type === "POSITION_WEIGHT_ABOVE" || condition.condition_type === "UNREALIZED_GAIN_REACH") {
    return readHoldingMetric(db, condition);
  }
  const windowDays = Number(condition.window_days ?? 20);
  const points = readMarketPoints(db, condition.instrument_id, Math.max(windowDays, 2));
  const latest = points[0];
  if (!latest) return insufficient();
  if (condition.condition_type === "PRICE_ABOVE" || condition.condition_type === "PRICE_BELOW") {
    return metric(latest.close, latest.date, { close: latest.close.toNumber() });
  }
  if (condition.condition_type === "DAILY_MOVE_REACH") {
    const previous = latest.previousClose ?? points[1]?.close ?? null;
    if (!previous?.gt(0)) return insufficient(latest.date);
    const move = latest.close.div(previous).minus(1).abs();
    return metric(move, latest.date, { close: latest.close.toNumber(), previousClose: previous.toNumber() });
  }
  if (points.length < windowDays) return insufficient(latest.date);
  const peak = points.reduce((current, point) => Decimal.max(current, point.close), latest.close);
  const drawdown = peak.gt(0) ? Decimal.max(0, new Decimal(1).minus(latest.close.div(peak))) : new Decimal(0);
  return metric(drawdown, latest.date, { close: latest.close.toNumber(), peak: peak.toNumber(), windowDays });
}

function readHoldingMetric(db: Db, condition: ConditionRow): ObservedMetric {
  const row = db.prepare(`SELECT ps.as_of, hs.quantity_decimal, hs.cost_decimal, hs.unrealized_pnl_decimal, hs.weight_bps
    FROM portfolio_snapshots ps JOIN holding_snapshots hs ON hs.portfolio_snapshot_id = ps.id
    WHERE ps.user_id = ? AND hs.instrument_id = ?
    ORDER BY ps.as_of DESC, ps.created_at DESC LIMIT 1`)
    .get(condition.user_id, condition.instrument_id) as Record<string, unknown> | undefined;
  if (!row) return insufficient();
  if (condition.condition_type === "POSITION_WEIGHT_ABOVE") {
    const weight = decimal(row.weight_bps).div(10_000);
    return metric(weight, String(row.as_of), { weight: weight.toNumber() });
  }
  const costBasis = decimal(row.cost_decimal).mul(decimal(row.quantity_decimal));
  if (!costBasis.gt(0)) return insufficient(String(row.as_of));
  const gain = decimal(row.unrealized_pnl_decimal).div(costBasis);
  return metric(gain, String(row.as_of), { unrealizedGain: gain.toNumber() });
}

function readMarketPoints(db: Db, instrumentId: string, limit: number): MarketPoint[] {
  const rows = db.prepare(`SELECT trading_date, as_of, raw_payload_json FROM market_snapshots
    WHERE instrument_id = ? ORDER BY trading_date DESC, as_of DESC, created_at DESC LIMIT ?`)
    .all(instrumentId, limit * 2) as Array<Record<string, unknown>>;
  const byDate = new Map<string, MarketPoint>();
  for (const row of rows) {
    const payload = parseJson<Record<string, unknown>>(String(row.raw_payload_json ?? "{}"), {});
    const date = normalizeDate(payload.date ?? payload.trade_date ?? row.trading_date ?? row.as_of);
    const close = safeDecimal(payload.close);
    if (!date || !close?.gt(0) || byDate.has(date)) continue;
    byDate.set(date, { date, close, previousClose: safeDecimal(payload.pre_close) });
  }
  return [...byDate.values()].sort((left, right) => right.date.localeCompare(left.date)).slice(0, limit);
}

function metric(value: Decimal, dataAsOf: string, metricSnapshot: Record<string, unknown>): ObservedMetric {
  return { value, dataAsOf, metricSnapshot };
}

function insufficient(dataAsOf: string | null = null): ObservedMetric {
  return { value: null, dataAsOf, metricSnapshot: {} };
}

function decimal(value: unknown): Decimal {
  return new Decimal(String(value ?? 0));
}

function safeDecimal(value: unknown): Decimal | null {
  try {
    const result = new Decimal(String(value ?? ""));
    return result.isFinite() ? result : null;
  } catch {
    return null;
  }
}

function normalizeDate(value: unknown): string {
  const text = String(value ?? "");
  const digits = text.replace(/\D/gu, "").slice(0, 8);
  return digits.length === 8 ? digits : "";
}

export function shanghaiDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
