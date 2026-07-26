import { getDatabase } from "@/server/http/context";

import {
  computeRiskAggregate,
  readMarketAggregate,
  readMarketPoints,
  type InstrumentRow,
  type MarketPoint,
} from "./aggregation-market";
import {
  readLatestAgentConclusion,
  readRecentEvent,
  readValuationAggregate,
} from "./aggregation-evidence";
import { readIndustryConcentration, readPortfolioRelation } from "./aggregation-portfolio";
import { notFound } from "./service-support";
import type {
  WatchlistItemAggregate,
  WatchlistItemSource,
  WatchlistItemsAggregate,
  WatchlistItemsSummary,
} from "./types";

type Db = ReturnType<typeof getDatabase>;
type ItemRow = InstrumentRow & {
  item_id: string;
  watchlist_id: string;
  reason: string | null;
  planned_horizon: string | null;
  source_type: string;
  row_version: number;
  goal_id: string | null;
  goal_name: string | null;
  drawdown_threshold_bps: number | null;
};
type ItemCounts = {
  activeConditionCount: number;
  triggeredConditionCount: number;
  unreadAlertCount: number;
  lastCheckedAt: string | null;
};

export {
  computeRiskAggregate,
  readIndustryConcentration,
  readLatestAgentConclusion,
  readMarketAggregate,
  readPortfolioRelation,
  readRecentEvent,
  readValuationAggregate,
};
export type { InstrumentRow, MarketPoint };

export function aggregateWatchlistItems(
  userId: string,
  watchlistId: string,
  limit: number,
): WatchlistItemAggregate[] {
  const db = getDatabase();
  try {
    requireWatchlist(db, userId, watchlistId);
    return readItemRows(db, userId, watchlistId, limit).map((row) => aggregateRow(db, userId, row));
  } finally {
    db.close();
  }
}

export function aggregateWatchlistCollection(
  userId: string,
  watchlistId: string,
  limit: number,
): WatchlistItemsAggregate {
  const items = aggregateWatchlistItems(userId, watchlistId, limit);
  return { items, summary: summarizeWatchlistItems(items) };
}

export function aggregateWatchlistItem(userId: string, itemId: string): WatchlistItemAggregate {
  const db = getDatabase();
  try {
    const row = db.prepare(`${itemSelect()}
      WHERE wi.id = ? AND wi.status = 'active' AND w.user_id = ? AND w.status != 'deleted'`)
      .get(itemId, userId) as ItemRow | undefined;
    if (!row) throw notFound("观察条目不存在");
    return aggregateRow(db, userId, row);
  } finally {
    db.close();
  }
}

export function summarizeWatchlistItems(items: WatchlistItemAggregate[]): WatchlistItemsSummary {
  const checked = items.map((item) => item.lastCheckedAt).filter((value): value is string => value !== null);
  return {
    itemCount: items.length,
    heldCount: items.filter((item) => item.portfolioRelation.isHeld).length,
    activeConditionCount: items.reduce((sum, item) => sum + item.activeConditionCount, 0),
    unreadAlertCount: items.reduce((sum, item) => sum + item.unreadAlertCount, 0),
    insufficientDataCount: items.filter(hasInsufficientData).length,
    lastCheckedAt: checked.sort().at(-1) ?? null,
  };
}

function aggregateRow(db: Db, userId: string, row: ItemRow): WatchlistItemAggregate {
  const counts = readItemCounts(db, userId, row.item_id);
  const drawdownThresholdBps = readLegacyDrawdownThresholdBps(db, row);
  return {
    id: row.item_id,
    watchlistId: row.watchlist_id,
    name: row.name,
    symbol: row.symbol,
    row_version: Number(row.row_version),
    planned_horizon: row.planned_horizon,
    drawdown_threshold_bps: drawdownThresholdBps,
    instrument: {
      id: row.id,
      symbol: row.symbol,
      name: row.name,
      assetType: row.asset_type,
      sector: row.sector,
    },
    reason: row.reason,
    plannedHorizon: row.planned_horizon,
    goal: row.goal_id && row.goal_name ? { id: row.goal_id, name: row.goal_name } : null,
    source: row.source_type.toUpperCase() as WatchlistItemSource,
    version: Number(row.row_version),
    market: readMarketAggregate(db, row),
    portfolioRelation: readPortfolioRelation(db, userId, row.id),
    risk: computeRiskAggregate(readMarketPoints(db, row.id)),
    valuation: readValuationAggregate(db, userId, row.id),
    recentEvent: readRecentEvent(db, userId, row.id),
    industryConcentration: readIndustryConcentration(db, userId, row.sector),
    latestAgentConclusion: readLatestAgentConclusion(db, userId, row.id),
    ...counts,
  };
}

function readItemRows(db: Db, userId: string, watchlistId: string, limit: number): ItemRow[] {
  return db.prepare(`${itemSelect()}
    WHERE wi.watchlist_id = ? AND wi.status = 'active' AND w.user_id = ? AND w.status != 'deleted'
    ORDER BY wi.added_at DESC,wi.id DESC LIMIT ?`).all(watchlistId, userId, limit) as ItemRow[];
}

function itemSelect(): string {
  return `SELECT wi.id AS item_id,wi.watchlist_id,wi.reason,wi.planned_horizon,wi.source_type,
      wi.row_version,wi.goal_id,wi.drawdown_threshold_bps,g.name AS goal_name,
      i.id,i.symbol,i.name,i.market,i.asset_type,i.sector
    FROM watchlist_items wi
    JOIN watchlists w ON w.id = wi.watchlist_id
    JOIN instruments i ON i.id = wi.instrument_id
    LEFT JOIN goals g ON g.id = wi.goal_id AND g.user_id = w.user_id`;
}

function readLegacyDrawdownThresholdBps(db: Db, row: ItemRow): number | null {
  const condition = db.prepare(`SELECT status,threshold_decimal FROM observation_conditions
    WHERE watchlist_item_id = ? AND condition_type = 'DRAWDOWN_REACH'
    ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, created_at, id LIMIT 1`)
    .get(row.item_id) as { status: string; threshold_decimal: string } | undefined;
  if (condition) return condition.status === "active"
    ? Math.round(Number(condition.threshold_decimal) * 10_000)
    : null;
  return row.drawdown_threshold_bps == null ? null : Number(row.drawdown_threshold_bps);
}

function readItemCounts(db: Db, userId: string, itemId: string): ItemCounts {
  const condition = db.prepare(`SELECT
      COUNT(*) FILTER (WHERE status = 'active') AS active_count,
      MAX(last_evaluated_at) AS last_checked_at
    FROM observation_conditions WHERE watchlist_item_id = ?`)
    .get(itemId) as { active_count: number; last_checked_at: string | null };
  const lastCheckedAt = condition.last_checked_at ?? null;
  const triggered = lastCheckedAt
    ? db.prepare(`SELECT COUNT(DISTINCT e.condition_id) AS count
        FROM observation_condition_events e JOIN observation_conditions c ON c.id = e.condition_id
        WHERE c.watchlist_item_id = ? AND e.triggered_at = ?`)
      .get(itemId, lastCheckedAt) as { count: number }
    : { count: 0 };
  const unread = db.prepare(`SELECT COUNT(*) AS count FROM notifications n
    WHERE n.user_id = ? AND n.read_at IS NULL AND n.dismissed_at IS NULL AND (
      n.source_id = ? OR n.condition_id IN
        (SELECT id FROM observation_conditions WHERE watchlist_item_id = ?)
      OR CASE WHEN json_valid(n.metadata_json)
        THEN json_extract(n.metadata_json,'$.watchlistItemId') END = ?
    )`).get(userId, itemId, itemId, itemId) as { count: number };
  return {
    activeConditionCount: Number(condition.active_count),
    triggeredConditionCount: Number(triggered.count),
    unreadAlertCount: Number(unread.count),
    lastCheckedAt,
  };
}

function requireWatchlist(db: Db, userId: string, watchlistId: string): void {
  const exists = db.prepare(`SELECT id FROM watchlists
    WHERE id = ? AND user_id = ? AND status != 'deleted'`).get(watchlistId, userId);
  if (!exists) throw notFound("观察列表不存在");
}

function hasInsufficientData(item: WatchlistItemAggregate): boolean {
  return item.market.status === "insufficient_data"
    || item.risk.status === "insufficient_data"
    || item.valuation.status === "insufficient_data"
    || item.industryConcentration.level === "insufficient_data";
}
