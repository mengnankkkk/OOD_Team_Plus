import { createId, getDatabase, isoNow } from "@/server/http/context";

import {
  archivedError,
  assertVersion,
  duplicateItemError,
  has,
  isUniqueError,
  moveConflict,
  notFound,
  readWatchlistItem,
  requireActiveItem,
  requireActiveWatchlist,
  requireInstrument,
  validateGoal,
  versionError,
} from "./service-support";
import type { CreateWatchlistItemInput, WatchlistItemBase, WatchlistItemPatch } from "./types";
import { WatchlistDomainError } from "./types";

export { createWatchlist, deleteWatchlist, getWatchlist, listWatchlists, updateWatchlist } from "./list-service";

export function listWatchlistItems(userId: string, watchlistId: string, limit: number): WatchlistItemBase[] {
  const db = getDatabase();
  try {
    requireActiveWatchlistOrArchived(db, userId, watchlistId);
    const ids = db.prepare(`SELECT id FROM watchlist_items
      WHERE watchlist_id = ? AND status = 'active' ORDER BY added_at DESC, id DESC LIMIT ?`)
      .all(watchlistId, limit) as Array<{ id: string }>;
    return ids.map(({ id }) => readWatchlistItem(db, userId, id));
  } finally {
    db.close();
  }
}

export function getWatchlistItem(userId: string, itemId: string): WatchlistItemBase {
  const db = getDatabase();
  try {
    return readWatchlistItem(db, userId, itemId);
  } finally {
    db.close();
  }
}

export function createWatchlistItem(
  userId: string,
  watchlistId: string,
  input: CreateWatchlistItemInput,
): WatchlistItemBase {
  const db = getDatabase();
  let itemId = "";
  try {
    db.transaction(() => {
      requireActiveWatchlist(db, userId, watchlistId);
      requireInstrument(db, input.instrumentId);
      validateGoal(db, userId, input.goalId);
      const active = db.prepare(`SELECT id FROM watchlist_items
        WHERE watchlist_id = ? AND instrument_id = ? AND status = 'active'`)
        .get(watchlistId, input.instrumentId) as { id: string } | undefined;
      if (active) throw duplicateItemError(watchlistId, input.instrumentId, active.id);

      const now = isoNow();
      const removed = db.prepare(`SELECT id FROM watchlist_items
        WHERE watchlist_id = ? AND instrument_id = ? AND status = 'removed'
        ORDER BY removed_at DESC, created_at DESC, id DESC LIMIT 1`)
        .get(watchlistId, input.instrumentId) as { id: string } | undefined;
      itemId = removed?.id ?? createId("watchitem");
      if (removed) {
        db.prepare(`UPDATE watchlist_items SET reason = ?, planned_horizon = ?, goal_id = ?, source_type = ?,
          status = 'active', added_at = ?, removed_at = NULL, updated_at = ?, row_version = row_version + 1
          WHERE id = ? AND status = 'removed'`)
          .run(input.reason ?? null, input.plannedHorizon ?? null, input.goalId ?? null, input.source.toLowerCase(), now, now, itemId);
      } else {
        db.prepare(`INSERT INTO watchlist_items
          (id, watchlist_id, instrument_id, reason, planned_horizon, goal_id, source_type,
           status, added_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`)
          .run(
            itemId,
            watchlistId,
            input.instrumentId,
            input.reason ?? null,
            input.plannedHorizon ?? null,
            input.goalId ?? null,
            input.source.toLowerCase(),
            now,
            now,
            now,
          );
      }
      createInitialDrawdownCondition(db, userId, itemId, input, now);
    })();
    return readWatchlistItem(db, userId, itemId);
  } catch (error) {
    if (error instanceof WatchlistDomainError) throw error;
    if (isUniqueError(error)) {
      const existing = db.prepare(`SELECT id FROM watchlist_items
        WHERE watchlist_id = ? AND instrument_id = ? AND status = 'active'`)
        .get(watchlistId, input.instrumentId) as { id: string } | undefined;
      if (existing) throw duplicateItemError(watchlistId, input.instrumentId, existing.id);
    }
    throw error;
  } finally {
    db.close();
  }
}

export function updateWatchlistItem(
  userId: string,
  itemId: string,
  input: WatchlistItemPatch,
  version: number,
): WatchlistItemBase {
  const db = getDatabase();
  try {
    const current = requireActiveItem(db, userId, itemId);
    assertVersion(current, version, "观察条目已被修改");
    validateGoal(db, userId, input.goalId);
    const result = db.prepare(`UPDATE watchlist_items SET
      reason = CASE WHEN ? THEN ? ELSE reason END,
      planned_horizon = CASE WHEN ? THEN ? ELSE planned_horizon END,
      goal_id = CASE WHEN ? THEN ? ELSE goal_id END,
      updated_at = ?, row_version = row_version + 1
      WHERE id = ? AND status = 'active' AND row_version = ?`)
      .run(
        has(input, "reason") ? 1 : 0,
        input.reason ?? null,
        has(input, "plannedHorizon") ? 1 : 0,
        input.plannedHorizon ?? null,
        has(input, "goalId") ? 1 : 0,
        input.goalId ?? null,
        isoNow(),
        itemId,
        version,
      );
    if (!result.changes) throw versionError(current.row_version, "观察条目已被修改");
    return readWatchlistItem(db, userId, itemId);
  } finally {
    db.close();
  }
}

export function moveWatchlistItem(
  userId: string,
  itemId: string,
  targetWatchlistId: string,
  version: number,
): WatchlistItemBase {
  const db = getDatabase();
  try {
    const current = requireActiveItem(db, userId, itemId);
    assertVersion(current, version, "观察条目已被修改");
    requireActiveWatchlist(db, userId, targetWatchlistId);
    if (current.watchlist_id === targetWatchlistId) return readWatchlistItem(db, userId, itemId);
    const duplicate = db.prepare(`SELECT id FROM watchlist_items
      WHERE watchlist_id = ? AND instrument_id = ? AND status = 'active'`)
      .get(targetWatchlistId, current.instrument_id) as { id: string } | undefined;
    if (duplicate) throw moveConflict(targetWatchlistId, current.instrument_id, duplicate.id);
    try {
      const result = db.prepare(`UPDATE watchlist_items SET watchlist_id = ?, updated_at = ?,
        row_version = row_version + 1 WHERE id = ? AND status = 'active' AND row_version = ?`)
        .run(targetWatchlistId, isoNow(), itemId, version);
      if (!result.changes) throw versionError(current.row_version, "观察条目已被修改");
    } catch (error) {
      if (isUniqueError(error)) throw moveConflict(targetWatchlistId, current.instrument_id, "");
      throw error;
    }
    return readWatchlistItem(db, userId, itemId);
  } finally {
    db.close();
  }
}

export function removeWatchlistItem(userId: string, itemId: string, version: number): void {
  const db = getDatabase();
  try {
    db.transaction(() => {
      const current = db.prepare(`SELECT wi.status, wi.row_version, w.status AS watchlist_status
        FROM watchlist_items wi JOIN watchlists w ON w.id = wi.watchlist_id
        WHERE wi.id = ? AND w.user_id = ? AND w.status != 'deleted'`)
        .get(itemId, userId) as { row_version: number; status: string; watchlist_status: string } | undefined;
      if (!current) throw notFound("观察条目不存在");
      if (current.status !== "active") return;
      if (current.watchlist_status === "archived") throw archivedError();
      assertVersion(current, version, "观察条目已被修改");
      const now = isoNow();
      db.prepare(`UPDATE observation_conditions SET status = 'paused', updated_at = ?, version = version + 1
        WHERE watchlist_item_id = ? AND status = 'active'`).run(now, itemId);
      const result = db.prepare(`UPDATE watchlist_items SET status = 'removed', removed_at = ?, updated_at = ?,
        row_version = row_version + 1 WHERE id = ? AND status = 'active' AND row_version = ?`)
        .run(now, now, itemId, version);
      if (!result.changes) throw versionError(current.row_version, "观察条目已被修改");
    })();
  } finally {
    db.close();
  }
}

function createInitialDrawdownCondition(
  db: ReturnType<typeof getDatabase>,
  userId: string,
  itemId: string,
  input: CreateWatchlistItemInput,
  now: string,
): void {
  if (input.initialDrawdownThresholdPct == null) return;
  db.prepare(`INSERT INTO observation_conditions
    (id, user_id, instrument_id, condition_type, threshold_decimal, status,
     watchlist_item_id, severity, window_days, config_json, created_at, updated_at)
    VALUES (?, ?, ?, 'DRAWDOWN_REACH', ?, 'active', ?, 'attention', 20, '{}', ?, ?)`)
    .run(
      createId("condition"),
      userId,
      input.instrumentId,
      String(input.initialDrawdownThresholdPct / 100),
      itemId,
      now,
      now,
    );
}

function requireActiveWatchlistOrArchived(
  db: ReturnType<typeof getDatabase>,
  userId: string,
  watchlistId: string,
): void {
  const row = db.prepare("SELECT id FROM watchlists WHERE id = ? AND user_id = ? AND status != 'deleted'")
    .get(watchlistId, userId);
  if (!row) throw notFound("观察列表不存在");
}
