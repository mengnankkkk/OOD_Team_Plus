import Decimal from "decimal.js";

import type { getDatabase } from "@/server/http/context";

import type { IndustryConcentrationAggregate, PortfolioRelationAggregate } from "./types";

type Db = ReturnType<typeof getDatabase>;
type SnapshotRow = {
  id: string;
  as_of: string;
  total_market_value_decimal: string;
};
type HoldingRow = {
  quantity_decimal: string;
  cost_decimal: string;
  market_value_decimal: string;
  unrealized_pnl_decimal: string;
};

export function readPortfolioRelation(
  db: Db,
  userId: string,
  instrumentId: string,
): PortfolioRelationAggregate {
  const snapshots = currentSnapshots(db, userId);
  if (!snapshots.length) return unavailableRelation();
  const snapshotIds = snapshots.map((snapshot) => snapshot.id);
  const holdings = db.prepare(`SELECT quantity_decimal,cost_decimal,market_value_decimal,
      unrealized_pnl_decimal FROM holding_snapshots
    WHERE portfolio_snapshot_id IN (${snapshotIds.map(() => "?").join(",")})
      AND instrument_id = ?`)
    .all(...snapshotIds, instrumentId) as HoldingRow[];
  const dataAsOf = latestAsOf(snapshots);
  if (!holdings.length) return { ...unavailableRelation(), dataAsOf };
  const quantity = sum(holdings, (holding) => holding.quantity_decimal);
  const marketValue = sum(holdings, (holding) => holding.market_value_decimal);
  const unrealizedPnl = sum(holdings, (holding) => holding.unrealized_pnl_decimal);
  const costBasis = holdings.reduce(
    (total, holding) => total.plus(decimal(holding.quantity_decimal).mul(holding.cost_decimal)),
    new Decimal(0),
  );
  const totalMarketValue = snapshots.reduce(
    (total, snapshot) => total.plus(snapshot.total_market_value_decimal),
    new Decimal(0),
  );
  return {
    isHeld: true,
    quantity: quantity.toNumber(),
    weight: totalMarketValue.gt(0) ? marketValue.div(totalMarketValue).toNumber() : null,
    cost: quantity.gt(0) ? costBasis.div(quantity).toNumber() : null,
    unrealizedGainPct: costBasis.gt(0) ? unrealizedPnl.div(costBasis).toNumber() : null,
    dataAsOf,
  };
}

export function readIndustryConcentration(
  db: Db,
  userId: string,
  sector: string | null,
): IndustryConcentrationAggregate {
  const snapshots = currentSnapshots(db, userId);
  if (!snapshots.length || !sector) return unavailableConcentration(sector);
  const snapshotIds = snapshots.map((snapshot) => snapshot.id);
  const row = db.prepare(`SELECT COALESCE(SUM(CAST(h.market_value_decimal AS REAL)),0) AS market_value
    FROM holding_snapshots h JOIN instruments i ON i.id = h.instrument_id
    WHERE h.portfolio_snapshot_id IN (${snapshotIds.map(() => "?").join(",")})
      AND i.sector = ?`)
    .get(...snapshotIds, sector) as { market_value: number };
  const totalMarketValue = snapshots.reduce(
    (total, snapshot) => total.plus(snapshot.total_market_value_decimal),
    new Decimal(0),
  );
  const weight = totalMarketValue.gt(0)
    ? new Decimal(row.market_value).div(totalMarketValue).toNumber()
    : 0;
  return {
    label: "组合行业集中度",
    sector,
    weight,
    level: weight >= 0.5 ? "critical" : weight >= 0.35 ? "high" : weight >= 0.2 ? "medium" : "low",
    dataAsOf: latestAsOf(snapshots),
  };
}

function currentSnapshots(db: Db, userId: string): SnapshotRow[] {
  return db.prepare(`SELECT ps.id,ps.as_of,ps.total_market_value_decimal
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
    ORDER BY ps.portfolio_id,ps.id`).all(userId) as SnapshotRow[];
}

function latestAsOf(snapshots: SnapshotRow[]): string | null {
  return snapshots.map((snapshot) => snapshot.as_of).sort().at(-1) ?? null;
}

function sum<T>(items: T[], value: (item: T) => string): Decimal {
  return items.reduce((total, item) => total.plus(decimal(value(item))), new Decimal(0));
}

function decimal(value: unknown): Decimal {
  return new Decimal(String(value ?? 0));
}

function unavailableRelation(): PortfolioRelationAggregate {
  return {
    isHeld: false,
    quantity: null,
    weight: null,
    cost: null,
    unrealizedGainPct: null,
    dataAsOf: null,
  };
}

function unavailableConcentration(sector: string | null): IndustryConcentrationAggregate {
  return {
    label: "组合行业集中度",
    sector,
    weight: null,
    level: "insufficient_data",
    dataAsOf: null,
  };
}
