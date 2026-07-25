import type { getDatabase } from "@/server/http/context";

import type { IndustryConcentrationAggregate, PortfolioRelationAggregate } from "./types";

type Db = ReturnType<typeof getDatabase>;
type SnapshotRow = { id: string; as_of: string };
type HoldingRow = {
  quantity_decimal: string;
  cost_decimal: string;
  unrealized_pnl_decimal: string;
  weight_bps: number;
};

export function readPortfolioRelation(
  db: Db,
  userId: string,
  instrumentId: string,
): PortfolioRelationAggregate {
  const snapshot = latestSnapshot(db, userId);
  if (!snapshot) return unavailableRelation();
  const holding = db.prepare(`SELECT quantity_decimal,cost_decimal,unrealized_pnl_decimal,weight_bps
    FROM holding_snapshots WHERE portfolio_snapshot_id = ? AND instrument_id = ? LIMIT 1`)
    .get(snapshot.id, instrumentId) as HoldingRow | undefined;
  if (!holding) return { ...unavailableRelation(), dataAsOf: snapshot.as_of };
  const quantity = finiteNumber(holding.quantity_decimal);
  const cost = finiteNumber(holding.cost_decimal);
  const unrealizedPnl = finiteNumber(holding.unrealized_pnl_decimal);
  const costBasis = quantity !== null && cost !== null ? quantity * cost : null;
  return {
    isHeld: true,
    quantity,
    weight: Number(holding.weight_bps) / 10_000,
    cost,
    unrealizedGainPct: costBasis && unrealizedPnl !== null ? unrealizedPnl / costBasis : null,
    dataAsOf: snapshot.as_of,
  };
}

export function readIndustryConcentration(
  db: Db,
  userId: string,
  sector: string | null,
): IndustryConcentrationAggregate {
  const snapshot = latestSnapshot(db, userId);
  if (!snapshot || !sector) return unavailableConcentration(sector);
  const row = db.prepare(`SELECT COALESCE(SUM(h.weight_bps),0) AS weight_bps
    FROM holding_snapshots h JOIN instruments i ON i.id = h.instrument_id
    WHERE h.portfolio_snapshot_id = ? AND i.sector = ?`)
    .get(snapshot.id, sector) as { weight_bps: number };
  const weight = Number(row.weight_bps) / 10_000;
  return {
    label: "组合行业集中度",
    sector,
    weight,
    level: weight >= 0.5 ? "critical" : weight >= 0.35 ? "high" : weight >= 0.2 ? "medium" : "low",
    dataAsOf: snapshot.as_of,
  };
}

function latestSnapshot(db: Db, userId: string): SnapshotRow | undefined {
  return db.prepare(`SELECT id,as_of FROM portfolio_snapshots
    WHERE user_id = ? ORDER BY as_of DESC,created_at DESC,id DESC LIMIT 1`)
    .get(userId) as SnapshotRow | undefined;
}

function finiteNumber(value: unknown): number | null {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
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
