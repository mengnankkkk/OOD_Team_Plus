import { getDatabase } from "@/server/http/context";

import type { WatchlistItemBase, WatchlistItemSource, WatchlistStatus, WatchlistSummary } from "./types";
import { WatchlistDomainError } from "./types";

export type Db = ReturnType<typeof getDatabase>;
export type Row = Record<string, unknown>;
export type WatchlistRow = Row & { row_version: number; status: WatchlistStatus };
export type ActiveItemRow = Row & {
  instrument_id: string;
  row_version: number;
  watchlist_id: string;
  watchlist_status: string;
};

export function readWatchlistSummary(db: Db, userId: string, id: string): WatchlistSummary {
  const row = db.prepare(`SELECT w.*,
      (SELECT COUNT(*) FROM watchlist_items wi WHERE wi.watchlist_id = w.id AND wi.status = 'active') AS item_count,
      (SELECT COUNT(*) FROM observation_conditions oc JOIN watchlist_items wi ON wi.id = oc.watchlist_item_id
        WHERE wi.watchlist_id = w.id AND wi.status = 'active' AND oc.status = 'active') AS active_condition_count,
      (SELECT COUNT(*) FROM notifications n WHERE n.user_id = w.user_id AND n.read_at IS NULL
        AND n.dismissed_at IS NULL AND json_extract(n.metadata_json, '$.watchlistId') = w.id) AS unread_alert_count
    FROM watchlists w WHERE w.id = ? AND w.user_id = ? AND w.status != 'deleted'`)
    .get(id, userId) as Row | undefined;
  if (!row) throw notFound("观察列表不存在");
  return {
    id: String(row.id),
    name: String(row.name),
    description: nullableString(row.description),
    status: String(row.status) as WatchlistStatus,
    itemCount: Number(row.item_count),
    activeConditionCount: Number(row.active_condition_count),
    unreadAlertCount: Number(row.unread_alert_count),
    version: Number(row.row_version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function readWatchlistItem(db: Db, userId: string, id: string): WatchlistItemBase {
  const row = db.prepare(`SELECT wi.*,
      (SELECT COUNT(*) FROM observation_conditions oc WHERE oc.watchlist_item_id = wi.id AND oc.status = 'active')
        AS active_condition_count
    FROM watchlist_items wi JOIN watchlists w ON w.id = wi.watchlist_id
    WHERE wi.id = ? AND wi.status = 'active' AND w.user_id = ? AND w.status != 'deleted'`)
    .get(id, userId) as Row | undefined;
  if (!row) throw notFound("观察条目不存在");
  return {
    id: String(row.id),
    watchlistId: String(row.watchlist_id),
    instrumentId: String(row.instrument_id),
    reason: nullableString(row.reason),
    plannedHorizon: nullableString(row.planned_horizon),
    goalId: nullableString(row.goal_id),
    source: String(row.source_type).toUpperCase() as WatchlistItemSource,
    activeConditionCount: Number(row.active_condition_count),
    version: Number(row.row_version),
  };
}

export function requireWatchlist(db: Db, userId: string, id: string): WatchlistRow {
  const row = db.prepare("SELECT * FROM watchlists WHERE id = ? AND user_id = ? AND status != 'deleted'")
    .get(id, userId) as WatchlistRow | undefined;
  if (!row) throw notFound("观察列表不存在");
  return row;
}

export function requireActiveWatchlist(db: Db, userId: string, id: string): WatchlistRow {
  const row = requireWatchlist(db, userId, id);
  if (row.status === "archived") throw archivedError();
  return row;
}

export function requireActiveItem(db: Db, userId: string, id: string): ActiveItemRow {
  const row = db.prepare(`SELECT wi.*, w.status AS watchlist_status
    FROM watchlist_items wi JOIN watchlists w ON w.id = wi.watchlist_id
    WHERE wi.id = ? AND wi.status = 'active' AND w.user_id = ? AND w.status != 'deleted'`)
    .get(id, userId) as ActiveItemRow | undefined;
  if (!row) throw notFound("观察条目不存在");
  if (row.watchlist_status === "archived") throw archivedError();
  return row;
}

export function requireInstrument(db: Db, instrumentId: string): void {
  if (!db.prepare("SELECT id FROM instruments WHERE id = ? AND tradable = 1").get(instrumentId)) {
    throw notFound("可交易标的不存在");
  }
}

export function validateGoal(db: Db, userId: string, goalId: string | null | undefined): void {
  if (goalId && !db.prepare("SELECT id FROM goals WHERE id = ? AND user_id = ? AND status = 'active'").get(goalId, userId)) {
    throw notFound("关联目标不存在");
  }
}

export function duplicateItemError(
  watchlistId: string,
  instrumentId: string,
  existingItemId: string,
): WatchlistDomainError {
  return new WatchlistDomainError("WATCHLIST_ITEM_EXISTS", "该标的已在当前观察列表中", 409, {
    watchlistId,
    instrumentId,
    existingItemId,
  });
}

export function moveConflict(
  watchlistId: string,
  instrumentId: string,
  existingItemId: string,
): WatchlistDomainError {
  return new WatchlistDomainError("WATCHLIST_ITEM_MOVE_CONFLICT", "目标列表已包含该标的", 409, {
    watchlistId,
    instrumentId,
    existingItemId,
  });
}

export function notFound(message: string): WatchlistDomainError {
  return new WatchlistDomainError("RESOURCE_NOT_FOUND", message, 404);
}

export function archivedError(): WatchlistDomainError {
  return new WatchlistDomainError("WATCHLIST_ARCHIVED", "归档列表不可修改", 409);
}

export function versionError(currentVersion: unknown, message: string): WatchlistDomainError {
  return new WatchlistDomainError("VERSION_CONFLICT", message, 412, { currentVersion: Number(currentVersion) });
}

export function assertVersion(row: { row_version: unknown }, version: number, message: string): void {
  if (Number(row.row_version) !== version) throw versionError(row.row_version, message);
}

export function has(value: object, key: string): boolean {
  return Object.hasOwn(value, key);
}

export function isUniqueError(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/iu.test(error.message);
}

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}
