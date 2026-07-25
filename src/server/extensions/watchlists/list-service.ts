import { createId, getDatabase, isoNow } from "@/server/http/context";

import {
  assertVersion,
  isUniqueError,
  readWatchlistSummary,
  requireWatchlist,
  versionError,
} from "./service-support";
import type { WatchlistPatch, WatchlistSummary } from "./types";
import { WatchlistDomainError } from "./types";

export function createWatchlist(
  userId: string,
  input: { name: string; description?: string | null },
): WatchlistSummary {
  const db = getDatabase();
  const now = isoNow();
  const id = createId("watchlist");
  try {
    db.prepare(`INSERT INTO watchlists
      (id, user_id, name, description, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)`)
      .run(id, userId, input.name.trim(), input.description ?? null, now, now);
    return readWatchlistSummary(db, userId, id);
  } catch (error) {
    if (isUniqueError(error)) throw new WatchlistDomainError("RESOURCE_CONFLICT", "观察列表名称已存在", 409);
    throw error;
  } finally {
    db.close();
  }
}

export function listWatchlists(
  userId: string,
  status: "active" | "archived",
  limit: number,
): WatchlistSummary[] {
  const db = getDatabase();
  try {
    const ids = db.prepare(`SELECT id FROM watchlists
      WHERE user_id = ? AND status = ? ORDER BY updated_at DESC, id DESC LIMIT ?`)
      .all(userId, status, limit) as Array<{ id: string }>;
    return ids.map(({ id }) => readWatchlistSummary(db, userId, id));
  } finally {
    db.close();
  }
}

export function getWatchlist(userId: string, id: string): WatchlistSummary {
  const db = getDatabase();
  try {
    return readWatchlistSummary(db, userId, id);
  } finally {
    db.close();
  }
}

export function updateWatchlist(
  userId: string,
  id: string,
  input: WatchlistPatch,
  version: number,
): WatchlistSummary {
  const db = getDatabase();
  try {
    const current = requireWatchlist(db, userId, id);
    assertVersion(current, version, "观察列表已被修改");
    const result = db.prepare(`UPDATE watchlists SET
      name = CASE WHEN ? THEN ? ELSE name END,
      description = CASE WHEN ? THEN ? ELSE description END,
      status = CASE WHEN ? THEN ? ELSE status END,
      updated_at = ?, row_version = row_version + 1
      WHERE id = ? AND user_id = ? AND status != 'deleted' AND row_version = ?`)
      .run(
        Object.hasOwn(input, "name") ? 1 : 0,
        input.name?.trim() ?? null,
        Object.hasOwn(input, "description") ? 1 : 0,
        input.description ?? null,
        Object.hasOwn(input, "status") ? 1 : 0,
        input.status?.toLowerCase() ?? null,
        isoNow(),
        id,
        userId,
        version,
      );
    if (!result.changes) throw versionError(current.row_version, "观察列表已被修改");
    return readWatchlistSummary(db, userId, id);
  } catch (error) {
    if (isUniqueError(error)) throw new WatchlistDomainError("RESOURCE_CONFLICT", "观察列表名称已存在", 409);
    throw error;
  } finally {
    db.close();
  }
}

export function deleteWatchlist(userId: string, id: string, version: number): void {
  const db = getDatabase();
  try {
    const transaction = db.transaction(() => {
      const current = db.prepare("SELECT status, row_version FROM watchlists WHERE id = ? AND user_id = ?")
        .get(id, userId) as { row_version: number; status: string } | undefined;
      if (!current || current.status === "deleted") return;
      assertVersion(current, version, "观察列表已被修改");
      const now = isoNow();
      db.prepare(`UPDATE observation_conditions SET status = 'paused', updated_at = ?, version = version + 1
        WHERE status = 'active' AND watchlist_item_id IN
          (SELECT id FROM watchlist_items WHERE watchlist_id = ?)`).run(now, id);
      db.prepare(`UPDATE watchlist_items SET status = 'removed', removed_at = COALESCE(removed_at, ?),
        updated_at = ?, row_version = row_version + 1 WHERE watchlist_id = ? AND status = 'active'`)
        .run(now, now, id);
      const result = db.prepare(`UPDATE watchlists SET status = 'deleted', deleted_at = ?, updated_at = ?,
        row_version = row_version + 1 WHERE id = ? AND user_id = ? AND row_version = ?`)
        .run(now, now, id, userId, version);
      if (!result.changes) throw versionError(current.row_version, "观察列表已被修改");
    });
    transaction();
  } finally {
    db.close();
  }
}
