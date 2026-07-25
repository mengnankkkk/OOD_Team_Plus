import { evaluateConditions } from "@/server/extensions/notifications/alert-engine";
import {
  createWatchlistEventNotifications,
  createWatchlistNotifications,
  type WatchlistTarget,
} from "@/server/extensions/notifications/watchlist-alerts";
import { getDatabase } from "@/server/http/context";

import {
  isPandaDataConfigured,
  latestMarketDataAsOf,
  refreshScopedWatchlistMarket,
  type MarketRefreshResult,
} from "./check-market";
import { archivedError, notFound } from "./service-support";
import type { WatchlistCheckResult } from "./types";
import { WatchlistDomainError } from "./types";

type Scope = { targets: WatchlistTarget[]; conditionIds: string[] };
type CheckOptions = {
  forceMarketRefresh: boolean; reason?: string;
  refreshMarket?: (userId: string, targets: WatchlistTarget[]) => Promise<MarketRefreshResult>;
};

export async function checkWatchlist(
  userId: string,
  watchlistId: string,
  options: CheckOptions,
): Promise<WatchlistCheckResult> {
  return runScopedCheck(
    userId,
    loadWatchlistScope(userId, watchlistId),
    () => loadWatchlistScope(userId, watchlistId),
    options,
  );
}

export async function checkWatchlistItem(
  userId: string,
  itemId: string,
  options: CheckOptions,
): Promise<WatchlistCheckResult> {
  return runScopedCheck(
    userId,
    loadItemScope(userId, itemId),
    () => loadItemScope(userId, itemId),
    options,
  );
}

export async function checkWatchlistTargets(
  userId: string,
  targets: WatchlistTarget[],
  options: CheckOptions,
): Promise<WatchlistCheckResult> {
  const itemIds = targets.map((target) => target.id);
  return runScopedCheck(userId, {
    targets,
    conditionIds: loadConditionIds(userId, itemIds),
  }, () => loadActiveItemScope(userId, itemIds), options);
}

export function loadActiveWatchlistTargets(userId: string): WatchlistTarget[] {
  const db = getDatabase();
  try {
    return readTargets(db, `w.user_id=? AND w.status='active' AND wi.status='active'`, [userId]);
  } finally {
    db.close();
  }
}

async function runScopedCheck(
  userId: string,
  initialScope: Scope,
  reloadScope: () => Scope,
  options: CheckOptions,
): Promise<WatchlistCheckResult> {
  let scope = initialScope;
  let marketRefreshAttempted = false;
  let marketRefreshSucceeded = false;
  let marketRefreshHadSuccess = false;
  let error: { code: string; message: string } | null = null;
  if (options.forceMarketRefresh && scope.targets.length) {
    marketRefreshAttempted = true;
    if (!isPandaDataConfigured()) {
      error = {
        code: "PANDADATA_NOT_CONFIGURED",
        message: "行情源尚未完成部署配置，当前检查基于最近一次有效快照。",
      };
    } else {
      try {
        const refresh = await (options.refreshMarket ?? refreshScopedWatchlistMarket)(userId, scope.targets);
        marketRefreshSucceeded = refresh.complete;
        marketRefreshHadSuccess = refresh.succeededGroupCount > 0;
        if (!refresh.complete) {
          error = {
            code: refresh.errorCode ?? "WATCHLIST_REFRESH_PARTIAL",
            message: "部分观察标的行情刷新失败，已继续使用最近一次有效数据。",
          };
        }
      } catch (refreshError) {
        error = publicError(refreshError, "WATCHLIST_REFRESH_FAILED", "观察标的行情刷新失败，已继续使用最近一次有效数据。");
      }
    }
    try {
      scope = reloadScope();
    } catch (scopeError) {
      if (!isInactiveScopeError(scopeError)) throw scopeError;
      scope = { targets: [], conditionIds: [] };
      error ??= {
        code: "WATCHLIST_SCOPE_CHANGED",
        message: "观察范围在刷新期间已归档或移除，本次未继续生成提醒。",
      };
    }
  }

  let evaluatedConditionCount = 0;
  let createdNotificationCount = 0;
  try {
    const evaluations = scope.conditionIds.length
      ? evaluateConditions(scope.conditionIds, options.reason ?? "watchlist-check", userId)
      : [];
    evaluatedConditionCount = evaluations.length;
    createdNotificationCount += evaluations.filter((result) => result.triggered).length;
    createdNotificationCount += createWatchlistNotifications(userId, scope.targets);
    createdNotificationCount += createWatchlistEventNotifications(userId, scope.targets);
  } catch (evaluationError) {
    error ??= publicError(evaluationError, "WATCHLIST_EVALUATION_FAILED", "观察规则评估失败。");
  }

  const dataAsOf = latestMarketDataAsOf(scope.targets.map((target) => target.instrument_id));
  return {
    status: error
      ? (dataAsOf || evaluatedConditionCount > 0 || marketRefreshHadSuccess ? "PARTIAL" : "FAILED")
      : "SUCCEEDED",
    checkedItemCount: scope.targets.length,
    itemIds: scope.targets.map((target) => target.id),
    evaluatedConditionCount,
    createdNotificationCount,
    marketRefreshAttempted,
    marketRefreshSucceeded,
    dataAsOf,
    errorCode: error?.code ?? null,
    errorMessage: error?.message ?? null,
  };
}

function loadWatchlistScope(userId: string, watchlistId: string): Scope {
  const db = getDatabase();
  try {
    const list = db.prepare("SELECT status FROM watchlists WHERE id=? AND user_id=? AND status!='deleted'")
      .get(watchlistId, userId) as { status: string } | undefined;
    if (!list) throw notFound("观察列表不存在");
    if (list.status === "archived") throw archivedError();
    const targets = readTargets(db, "wi.watchlist_id=? AND w.user_id=? AND w.status='active' AND wi.status='active'", [
      watchlistId,
      userId,
    ]);
    return { targets, conditionIds: readConditionIds(db, targets.map((target) => target.id)) };
  } finally {
    db.close();
  }
}

function loadItemScope(userId: string, itemId: string): Scope {
  const db = getDatabase();
  try {
    const item = db.prepare(`SELECT wi.status,w.status AS watchlist_status
      FROM watchlist_items wi
      JOIN watchlists w ON w.id=wi.watchlist_id
      WHERE wi.id=? AND w.user_id=? AND w.status!='deleted'`)
      .get(itemId, userId) as { status: string; watchlist_status: string } | undefined;
    if (!item || item.status !== "active") throw notFound("观察条目不存在");
    if (item.watchlist_status === "archived") throw archivedError();
    const targets = readTargets(db, "wi.id=? AND w.user_id=? AND w.status='active' AND wi.status='active'", [
      itemId,
      userId,
    ]);
    return { targets, conditionIds: readConditionIds(db, [itemId]) };
  } finally {
    db.close();
  }
}

function loadActiveItemScope(userId: string, itemIds: string[]): Scope {
  if (!itemIds.length) return { targets: [], conditionIds: [] };
  const db = getDatabase();
  try {
    const targets = readTargets(
      db,
      `wi.id IN (${itemIds.map(() => "?").join(",")})
        AND w.user_id=? AND w.status='active' AND wi.status='active'`,
      [...itemIds, userId],
    );
    return { targets, conditionIds: readConditionIds(db, targets.map((target) => target.id), userId) };
  } finally {
    db.close();
  }
}

function loadConditionIds(userId: string, itemIds: string[]): string[] {
  if (!itemIds.length) return [];
  const db = getDatabase();
  try {
    return readConditionIds(db, itemIds, userId);
  } finally {
    db.close();
  }
}

function readTargets(
  db: ReturnType<typeof getDatabase>,
  where: string,
  params: unknown[],
): WatchlistTarget[] {
  return db.prepare(`SELECT wi.id,wi.watchlist_id,wi.instrument_id,wi.goal_id,wi.reason,wi.planned_horizon,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM observation_conditions existing
          WHERE existing.watchlist_item_id=wi.id AND existing.condition_type='DRAWDOWN_REACH'
        )
        THEN (
          SELECT CAST(ROUND(CAST(active.threshold_decimal AS REAL) * 10000) AS INTEGER)
          FROM observation_conditions active
          WHERE active.watchlist_item_id=wi.id AND active.condition_type='DRAWDOWN_REACH'
            AND active.status='active'
          ORDER BY active.created_at,active.id LIMIT 1
        )
        ELSE wi.drawdown_threshold_bps
      END AS drawdown_threshold_bps,
      i.symbol,i.name,i.market,i.asset_type
    FROM watchlist_items wi
    JOIN watchlists w ON w.id=wi.watchlist_id
    JOIN instruments i ON i.id=wi.instrument_id
    WHERE ${where}
    ORDER BY wi.added_at DESC,wi.id DESC`).all(...params) as WatchlistTarget[];
}

function readConditionIds(
  db: ReturnType<typeof getDatabase>,
  itemIds: string[],
  userId?: string,
): string[] {
  if (!itemIds.length) return [];
  const ownerClause = userId ? " AND user_id=?" : "";
  const rows = db.prepare(`SELECT id FROM observation_conditions
    WHERE watchlist_item_id IN (${itemIds.map(() => "?").join(",")})
      AND status='active'${ownerClause}
    ORDER BY created_at,id`).all(...itemIds, ...(userId ? [userId] : [])) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

function publicError(error: unknown, fallbackCode: string, fallbackMessage: string): { code: string; message: string } {
  if (error && typeof error === "object") {
    const value = error as { code?: unknown; details?: { category?: unknown } };
    return { code: String(value.details?.category ?? value.code ?? fallbackCode).slice(0, 80), message: fallbackMessage };
  }
  return { code: fallbackCode, message: fallbackMessage };
}

function isInactiveScopeError(error: unknown): boolean {
  return error instanceof WatchlistDomainError
    && (error.code === "WATCHLIST_ARCHIVED" || error.code === "RESOURCE_NOT_FOUND");
}
