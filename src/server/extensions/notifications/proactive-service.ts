import { refreshPortfolio } from "@/server/extensions/analysis/service";
import {
  checkWatchlistTargets,
  loadActiveWatchlistTargets,
} from "@/server/extensions/watchlists/check-service";
import { isPandaDataConfigured } from "@/server/extensions/watchlists/check-market";
import { getDatabase, isoNow } from "@/server/http/context";

import { evaluateConditions } from "./alert-engine";
import { createPortfolioNotifications } from "./portfolio-alerts";

const MARKET_REFRESH_INTERVAL_MS = 60 * 60 * 1_000;

type SyncStatus = "succeeded" | "partial" | "failed";

export type NotificationSyncResult = {
  status: SyncStatus;
  createdCount: number;
  evaluatedConditionCount: number;
  marketRefreshAttempted: boolean;
  marketRefreshSucceeded: boolean;
  dataAsOf: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export async function syncUserNotifications(
  userId: string,
  options: { forceMarketRefresh?: boolean; reason?: string } = {},
): Promise<NotificationSyncResult> {
  const now = isoNow();
  const context = loadSyncContext(userId);
  markSyncRunning(userId, now);

  let marketRefreshAttempted = false;
  let marketRefreshSucceeded = false;
  const errors: Array<{ code: string; message: string }> = [];
  const due = options.forceMarketRefresh || !context.lastMarketRefreshAt
    || Date.now() - Date.parse(context.lastMarketRefreshAt) >= MARKET_REFRESH_INTERVAL_MS;
  const hasTargets = Boolean(context.portfolioId || context.watchlistTargets.length);
  let watchlistCheck: Awaited<ReturnType<typeof checkWatchlistTargets>> | null = null;

  if (due && hasTargets) {
    marketRefreshAttempted = true;
    if (!isPandaDataConfigured()) {
      errors.push({ code: "PANDADATA_NOT_CONFIGURED", message: "行情源尚未完成部署配置，当前提醒基于最近一次有效快照。" });
    } else {
      let successfulMarketTasks = 0;
      let attemptedMarketTasks = 0;
      if (context.portfolioId) {
        attemptedMarketTasks += 1;
        try {
          await refreshPortfolio(userId, context.portfolioId);
          successfulMarketTasks += 1;
        } catch (error) {
          errors.push(publicError(error, "PORTFOLIO_REFRESH_FAILED", "持仓行情刷新失败，已继续使用最近一次有效快照。"));
        }
      }
      if (context.watchlistTargets.length) {
        attemptedMarketTasks += 1;
        watchlistCheck = await checkWatchlistTargets(userId, context.watchlistTargets, {
          forceMarketRefresh: true,
          reason: options.reason ?? "notification-sync",
        });
        if (watchlistCheck.marketRefreshSucceeded) successfulMarketTasks += 1;
        if (watchlistCheck.errorCode) {
          errors.push({
            code: watchlistCheck.errorCode,
            message: watchlistCheck.errorMessage ?? "观察列表检查失败。",
          });
        }
      }
      marketRefreshSucceeded = attemptedMarketTasks > 0
        && successfulMarketTasks === attemptedMarketTasks;
    }
  }

  let createdCount = 0;
  let evaluatedConditionCount = 0;
  try {
    if (!watchlistCheck) {
      watchlistCheck = await checkWatchlistTargets(userId, context.watchlistTargets, {
        forceMarketRefresh: false,
        reason: options.reason ?? "notification-sync",
      });
      if (watchlistCheck.errorCode) {
        errors.push({
          code: watchlistCheck.errorCode,
          message: watchlistCheck.errorMessage ?? "观察列表检查失败。",
        });
      }
    }
    createdCount += watchlistCheck.createdNotificationCount;
    evaluatedConditionCount += watchlistCheck.evaluatedConditionCount;
    const conditionIds = loadNonWatchlistConditionIds(userId);
    const conditionResults = conditionIds.length
      ? evaluateConditions(conditionIds, options.reason ?? "notification-sync", userId)
      : [];
    evaluatedConditionCount += conditionResults.length;
    createdCount += conditionResults.filter((item) => item.triggered).length;
    createdCount += createPortfolioNotifications(userId);
  } catch (error) {
    errors.push(publicError(error, "NOTIFICATION_EVALUATION_FAILED", "提醒规则评估失败。"));
  }

  const snapshot = latestSnapshot(userId);
  const status: SyncStatus = errors.length === 0 ? "succeeded" : createdCount > 0 || Boolean(snapshot) ? "partial" : "failed";
  const primaryError = errors[0] ?? null;
  persistSyncState({
    userId, status, now: isoNow(), dataAsOf: snapshot?.as_of ? String(snapshot.as_of) : null,
    marketRefreshedAt: marketRefreshSucceeded ? isoNow() : null,
    errorCode: primaryError?.code ?? null, errorMessage: primaryError?.message ?? null,
  });
  return {
    status, createdCount, evaluatedConditionCount, marketRefreshAttempted, marketRefreshSucceeded,
    dataAsOf: snapshot?.as_of ? String(snapshot.as_of) : null,
    errorCode: primaryError?.code ?? null, errorMessage: primaryError?.message ?? null,
  };
}

export function getNotificationSyncState(userId: string) {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM notification_sync_states WHERE user_id=?").get(userId) as Record<string, unknown> | undefined;
  db.close();
  return row ? formatSyncState(row) : {
    status: "idle", lastAttemptAt: null, lastSuccessAt: null, lastMarketRefreshAt: null,
    dataAsOf: null, errorCode: null, errorMessage: null,
  };
}

function loadSyncContext(userId: string) {
  const db = getDatabase();
  const holding = db.prepare("SELECT portfolio_id FROM holdings WHERE user_id=? AND status='active' ORDER BY updated_at DESC LIMIT 1").get(userId) as { portfolio_id?: string } | undefined;
  const state = db.prepare("SELECT last_market_refresh_at FROM notification_sync_states WHERE user_id=?").get(userId) as { last_market_refresh_at?: string } | undefined;
  db.close();
  return {
    portfolioId: holding?.portfolio_id ?? null,
    lastMarketRefreshAt: state?.last_market_refresh_at ?? null,
    watchlistTargets: loadActiveWatchlistTargets(userId),
  };
}

function loadNonWatchlistConditionIds(userId: string): string[] {
  const db = getDatabase();
  try {
    const rows = db.prepare(`SELECT id FROM observation_conditions
      WHERE user_id=? AND status='active' AND watchlist_item_id IS NULL
      ORDER BY created_at,id`).all(userId) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  } finally {
    db.close();
  }
}

function latestSnapshot(userId: string): Record<string, unknown> | undefined {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM portfolio_snapshots WHERE user_id=? ORDER BY as_of DESC,created_at DESC LIMIT 1").get(userId) as Record<string, unknown> | undefined;
  db.close();
  return row;
}

function markSyncRunning(userId: string, now: string): void {
  const db = getDatabase();
  db.prepare(`INSERT INTO notification_sync_states (user_id,status,last_attempt_at,created_at,updated_at)
    VALUES (?,'running',?,?,?) ON CONFLICT(user_id) DO UPDATE SET status='running',last_attempt_at=excluded.last_attempt_at,
    updated_at=excluded.updated_at,error_code=NULL,error_message=NULL`).run(userId, now, now, now);
  db.close();
}

function persistSyncState(input: { userId: string; status: SyncStatus; now: string; dataAsOf: string | null; marketRefreshedAt: string | null; errorCode: string | null; errorMessage: string | null }): void {
  const db = getDatabase();
  db.prepare(`UPDATE notification_sync_states SET status=?,last_success_at=CASE WHEN ?='failed' THEN last_success_at ELSE ? END,
    last_market_refresh_at=COALESCE(?,last_market_refresh_at),data_as_of=?,error_code=?,error_message=?,updated_at=? WHERE user_id=?`)
    .run(input.status, input.status, input.now, input.marketRefreshedAt, input.dataAsOf, input.errorCode, input.errorMessage, input.now, input.userId);
  db.close();
}

function formatSyncState(row: Record<string, unknown>) {
  return {
    status: row.status, lastAttemptAt: row.last_attempt_at, lastSuccessAt: row.last_success_at,
    lastMarketRefreshAt: row.last_market_refresh_at, dataAsOf: row.data_as_of,
    errorCode: row.error_code, errorMessage: row.error_message,
  };
}

function publicError(error: unknown, fallbackCode: string, fallbackMessage: string): { code: string; message: string } {
  if (error && typeof error === "object") {
    const value = error as { code?: unknown; details?: { category?: unknown } };
    return { code: String(value.details?.category ?? value.code ?? fallbackCode).slice(0, 80), message: fallbackMessage };
  }
  return { code: fallbackCode, message: fallbackMessage };
}
