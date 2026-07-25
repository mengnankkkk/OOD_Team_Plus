import { createId, getDatabase, isoNow } from "@/server/http/context";

import {
  CreateConditionSchema,
  normalizeCondition,
  PatchConditionSchema,
  type ObservationConditionType,
} from "./condition-contract";
import { WatchlistDomainError } from "../watchlists/types";

type Row = Record<string, unknown>;

export { CreateConditionSchema, PatchConditionSchema };

export function listConditions(
  userId: string,
  filters: { watchlistItemId?: string; status?: "active" | "paused" | "deleted"; limit: number },
): Array<Record<string, unknown>> {
  const db = getDatabase();
  try {
    const clauses = ["user_id = ?"];
    const params: unknown[] = [userId];
    if (filters.watchlistItemId) {
      clauses.push("watchlist_item_id = ?");
      params.push(filters.watchlistItemId);
    }
    if (filters.status) {
      clauses.push("status = ?");
      params.push(filters.status);
    } else {
      clauses.push("status != 'deleted'");
    }
    params.push(filters.limit);
    const rows = db.prepare(`SELECT * FROM observation_conditions
      WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...params) as Row[];
    return rows.map(formatCondition);
  } finally {
    db.close();
  }
}

export function createCondition(
  userId: string,
  input: {
    watchlistItemId: string;
    conditionType: ObservationConditionType;
    threshold?: string;
    thresholdDate?: string;
    windowDays?: number;
    severity: "INFORMATION" | "ATTENTION" | "IMPORTANT" | "URGENT";
  },
): Record<string, unknown> {
  const db = getDatabase();
  try {
    const item = requireOwnedItem(db, userId, input.watchlistItemId);
    const normalized = normalizeOrThrow(input);
    const now = isoNow();
    const id = createId("condition");
    db.prepare(`INSERT INTO observation_conditions
      (id,user_id,instrument_id,condition_type,threshold_decimal,status,watchlist_item_id,severity,
       threshold_date,window_days,config_json,created_at,updated_at)
      VALUES (?,?,?,?,?,'active',?,?,?,?, '{}',?,?)`)
      .run(
        id,
        userId,
        item.instrument_id,
        input.conditionType,
        normalized.threshold,
        input.watchlistItemId,
        input.severity.toLowerCase(),
        normalized.thresholdDate,
        normalized.windowDays,
        now,
        now,
      );
    return formatCondition(db.prepare("SELECT * FROM observation_conditions WHERE id = ?").get(id) as Row);
  } finally {
    db.close();
  }
}

export function updateCondition(
  userId: string,
  id: string,
  input: {
    threshold?: string;
    thresholdDate?: string | null;
    windowDays?: number | null;
    severity?: "INFORMATION" | "ATTENTION" | "IMPORTANT" | "URGENT";
    status?: "ACTIVE" | "PAUSED";
  },
  version: number,
): Record<string, unknown> {
  const db = getDatabase();
  try {
    const current = requireCondition(db, userId, id);
    if (Number(current.version) !== version) throw versionError(current.version);
    const conditionType = String(current.condition_type) as ObservationConditionType;
    const normalized = normalizeOrThrow({
      conditionType,
      threshold: conditionType === "REVIEW_DATE"
        ? input.threshold
        : input.threshold ?? String(current.threshold_decimal),
      thresholdDate: Object.hasOwn(input, "thresholdDate") ? input.thresholdDate ?? undefined : nullable(current.threshold_date),
      windowDays: Object.hasOwn(input, "windowDays") ? input.windowDays ?? undefined : numberOrUndefined(current.window_days),
    });
    const thresholdDateChanged = Object.hasOwn(input, "thresholdDate")
      && normalized.thresholdDate !== nullable(current.threshold_date);
    const result = db.prepare(`UPDATE observation_conditions SET threshold_decimal = ?, threshold_date = ?,
      window_days = ?, severity = COALESCE(?, severity), status = COALESCE(?, status),
      last_triggered_at = CASE WHEN ? THEN NULL ELSE last_triggered_at END,
      updated_at = ?, version = version + 1
      WHERE id = ? AND user_id = ? AND version = ?`)
      .run(
        normalized.threshold,
        normalized.thresholdDate,
        normalized.windowDays,
        input.severity?.toLowerCase() ?? null,
        input.status?.toLowerCase() ?? null,
        thresholdDateChanged ? 1 : 0,
        isoNow(),
        id,
        userId,
        version,
      );
    if (!result.changes) throw versionError(current.version);
    return formatCondition(db.prepare("SELECT * FROM observation_conditions WHERE id = ?").get(id) as Row);
  } finally {
    db.close();
  }
}

export function deleteCondition(userId: string, id: string, version: number): void {
  const db = getDatabase();
  try {
    const current = requireCondition(db, userId, id);
    if (String(current.status) === "deleted") return;
    if (Number(current.version) !== version) throw versionError(current.version);
    const result = db.prepare(`UPDATE observation_conditions SET status = 'deleted', updated_at = ?,
      version = version + 1 WHERE id = ? AND user_id = ? AND version = ?`)
      .run(isoNow(), id, userId, version);
    if (!result.changes) throw versionError(current.version);
  } finally {
    db.close();
  }
}

function requireOwnedItem(db: ReturnType<typeof getDatabase>, userId: string, itemId: string): { instrument_id: string } {
  const row = db.prepare(`SELECT wi.instrument_id FROM watchlist_items wi JOIN watchlists w ON w.id = wi.watchlist_id
    WHERE wi.id = ? AND wi.status = 'active' AND w.user_id = ? AND w.status = 'active'`)
    .get(itemId, userId) as { instrument_id: string } | undefined;
  if (!row) throw new WatchlistDomainError("RESOURCE_NOT_FOUND", "观察条目不存在", 404);
  return row;
}

function requireCondition(db: ReturnType<typeof getDatabase>, userId: string, id: string): Row {
  const row = db.prepare("SELECT * FROM observation_conditions WHERE id = ? AND user_id = ?")
    .get(id, userId) as Row | undefined;
  if (!row) throw new WatchlistDomainError("RESOURCE_NOT_FOUND", "观察规则不存在", 404);
  return row;
}

function normalizeOrThrow(input: Parameters<typeof normalizeCondition>[0]) {
  try {
    return normalizeCondition(input);
  } catch (error) {
    throw new WatchlistDomainError(
      "OBSERVATION_CONDITION_INVALID",
      error instanceof Error ? error.message : "观察规则无效",
      422,
    );
  }
}

function formatCondition(row: Row): Record<string, unknown> {
  return {
    id: String(row.id),
    watchlistItemId: nullable(row.watchlist_item_id),
    instrumentId: nullable(row.instrument_id),
    conditionType: String(row.condition_type),
    threshold: String(row.threshold_decimal),
    thresholdDate: nullable(row.threshold_date),
    windowDays: row.window_days == null ? null : Number(row.window_days),
    severity: String(row.severity).toUpperCase(),
    status: String(row.status).toUpperCase(),
    lastObserved: nullable(row.last_observed_decimal),
    lastEvaluatedAt: nullable(row.last_evaluated_at),
    lastTriggeredAt: nullable(row.last_triggered_at),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function versionError(currentVersion: unknown): WatchlistDomainError {
  return new WatchlistDomainError("VERSION_CONFLICT", "观察规则已被修改", 412, {
    currentVersion: Number(currentVersion),
  });
}

function nullable(value: unknown): string | null {
  return value == null ? null : String(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  return value == null ? undefined : Number(value);
}
