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
  evaluationSourceKey: string | null;
  metricSnapshot: Record<string, unknown>;
};

type Db = {
  prepare: (sql: string) => {
    get: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
  };
};

type MarketPoint = {
  close: Decimal;
  date: string;
  asOf: string;
  snapshotId: string;
  previousClose: Decimal | null;
};

type CurrentPortfolioSnapshot = {
  id: string;
  as_of: string;
  total_market_value_decimal: string;
};

type CurrentHolding = {
  quantity_decimal: string;
  cost_decimal: string;
  market_value_decimal: string;
  unrealized_pnl_decimal: string;
};

export function readObservedMetric(db: Db, condition: ConditionRow): ObservedMetric {
  if (condition.condition_type === "REVIEW_DATE") {
    const date = shanghaiDate();
    return {
      value: new Decimal(1),
      dataAsOf: date,
      evaluationSourceKey: date,
      metricSnapshot: { calendarDate: date },
    };
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
    return metric(latest.close, latest.asOf, latest.snapshotId, {
      close: latest.close.toNumber(),
      tradingDate: latest.date,
    });
  }
  if (condition.condition_type === "DAILY_MOVE_REACH") {
    const previous = latest.previousClose ?? points[1]?.close ?? null;
    if (!previous?.gt(0)) return insufficient(latest.asOf);
    const move = latest.close.div(previous).minus(1).abs();
    return metric(move, latest.asOf, latest.snapshotId, {
      close: latest.close.toNumber(),
      previousClose: previous.toNumber(),
      tradingDate: latest.date,
    });
  }
  if (points.length < windowDays) return insufficient(latest.asOf);
  const peak = points.reduce((current, point) => Decimal.max(current, point.close), latest.close);
  const drawdown = peak.gt(0) ? Decimal.max(0, new Decimal(1).minus(latest.close.div(peak))) : new Decimal(0);
  return metric(drawdown, latest.asOf, latest.snapshotId, {
    close: latest.close.toNumber(),
    peak: peak.toNumber(),
    tradingDate: latest.date,
    windowDays,
  });
}

function readHoldingMetric(db: Db, condition: ConditionRow): ObservedMetric {
  const snapshots = db.prepare(`SELECT ps.id,ps.as_of,ps.total_market_value_decimal
    FROM portfolio_snapshots ps
    WHERE ps.user_id=?
      AND EXISTS (
        SELECT 1 FROM holdings current
        WHERE current.user_id=ps.user_id
          AND current.portfolio_id=ps.portfolio_id
          AND current.status='active'
      )
      AND ps.id=(
        SELECT latest.id FROM portfolio_snapshots latest
        WHERE latest.user_id=ps.user_id AND latest.portfolio_id=ps.portfolio_id
        ORDER BY latest.as_of DESC,latest.created_at DESC,latest.id DESC LIMIT 1
      )
    ORDER BY ps.portfolio_id,ps.id`).all(condition.user_id) as CurrentPortfolioSnapshot[];
  if (!snapshots.length) return insufficient();
  const snapshotIds = snapshots.map((snapshot) => snapshot.id);
  const holdings = db.prepare(`SELECT quantity_decimal,cost_decimal,market_value_decimal,
      unrealized_pnl_decimal
    FROM holding_snapshots
    WHERE portfolio_snapshot_id IN (${snapshotIds.map(() => "?").join(",")})
      AND instrument_id=?`)
    .all(...snapshotIds, condition.instrument_id) as CurrentHolding[];
  const dataAsOf = snapshots.map((snapshot) => snapshot.as_of).sort().at(-1) ?? null;
  if (!holdings.length) return insufficient(dataAsOf);
  const evaluationSourceKey = snapshotIds.join("|");
  if (condition.condition_type === "POSITION_WEIGHT_ABOVE") {
    const totalMarketValue = snapshots.reduce(
      (sum, snapshot) => sum.plus(decimal(snapshot.total_market_value_decimal)),
      new Decimal(0),
    );
    if (!totalMarketValue.gt(0)) return insufficient(dataAsOf);
    const instrumentMarketValue = holdings.reduce(
      (sum, holding) => sum.plus(decimal(holding.market_value_decimal)),
      new Decimal(0),
    );
    const weight = instrumentMarketValue.div(totalMarketValue);
    return metric(weight, dataAsOf!, evaluationSourceKey, {
      portfolioSnapshotIds: snapshotIds,
      weight: weight.toNumber(),
    });
  }
  const costBasis = holdings.reduce(
    (sum, holding) => sum.plus(
      decimal(holding.cost_decimal).mul(decimal(holding.quantity_decimal)),
    ),
    new Decimal(0),
  );
  if (!costBasis.gt(0)) return insufficient(dataAsOf);
  const unrealizedPnl = holdings.reduce(
    (sum, holding) => sum.plus(decimal(holding.unrealized_pnl_decimal)),
    new Decimal(0),
  );
  const gain = unrealizedPnl.div(costBasis);
  return metric(gain, dataAsOf!, evaluationSourceKey, {
    portfolioSnapshotIds: snapshotIds,
    unrealizedGain: gain.toNumber(),
  });
}

function readMarketPoints(db: Db, instrumentId: string, limit: number): MarketPoint[] {
  const rows = db.prepare(`SELECT id,trading_date,as_of,raw_payload_json FROM market_snapshots
    WHERE instrument_id = ? ORDER BY trading_date DESC, as_of DESC, created_at DESC LIMIT ?`)
    .all(instrumentId, limit * 2) as Array<Record<string, unknown>>;
  const byDate = new Map<string, MarketPoint>();
  for (const row of rows) {
    const payload = parseJson<Record<string, unknown>>(String(row.raw_payload_json ?? "{}"), {});
    const date = normalizeDate(payload.date ?? payload.trade_date ?? row.trading_date ?? row.as_of);
    const close = safeDecimal(payload.close);
    if (!date || !close?.gt(0) || byDate.has(date)) continue;
    byDate.set(date, {
      date,
      close,
      asOf: String(row.as_of ?? date),
      snapshotId: String(row.id),
      previousClose: safeDecimal(payload.pre_close),
    });
  }
  return [...byDate.values()].sort((left, right) => right.date.localeCompare(left.date)).slice(0, limit);
}

function metric(
  value: Decimal,
  dataAsOf: string,
  evaluationSourceKey: string,
  metricSnapshot: Record<string, unknown>,
): ObservedMetric {
  return { value, dataAsOf, evaluationSourceKey, metricSnapshot };
}

function insufficient(dataAsOf: string | null = null): ObservedMetric {
  return { value: null, dataAsOf, evaluationSourceKey: null, metricSnapshot: {} };
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
