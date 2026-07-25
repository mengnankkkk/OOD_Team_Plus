import type { SqliteDb } from "@/server/db/client.runtime";
import { refreshPortfolio } from "@/server/extensions/analysis/service";
import type { PandaDataMethod } from "@/server/extensions/pandadata/adapter";
import { executePandaSources } from "@/server/extensions/query/panda-query-executor";
import type { MarketDatasetKey, PandaQuerySource } from "@/server/extensions/query/market-catalog";
import { createId, getDatabase, isoNow } from "@/server/http/context";

import { evaluateConditions } from "./alert-engine";
import { createPortfolioNotifications } from "./portfolio-alerts";
import { canonicalSymbol, createWatchlistNotifications, type WatchlistTarget } from "./watchlist-alerts";

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

  if (due && hasTargets) {
    marketRefreshAttempted = true;
    if (!isPandaDataConfigured()) {
      errors.push({ code: "PANDADATA_NOT_CONFIGURED", message: "行情源尚未完成部署配置，当前提醒基于最近一次有效快照。" });
    } else {
      let successfulMarketTasks = 0;
      if (context.portfolioId) {
        try {
          await refreshPortfolio(userId, context.portfolioId);
          successfulMarketTasks += 1;
        } catch (error) {
          errors.push(publicError(error, "PORTFOLIO_REFRESH_FAILED", "持仓行情刷新失败，已继续使用最近一次有效快照。"));
        }
      }
      if (context.watchlistTargets.length) {
        try {
          await refreshWatchlistMarket(userId, context.watchlistTargets);
          successfulMarketTasks += 1;
        } catch (error) {
          errors.push(publicError(error, "WATCHLIST_REFRESH_FAILED", "自选行情刷新失败，已继续使用最近一次有效数据。"));
        }
      }
      marketRefreshSucceeded = successfulMarketTasks > 0;
    }
  }

  let createdCount = 0;
  let evaluatedConditionCount = 0;
  try {
    const conditionResults = evaluateConditions(undefined, options.reason ?? "notification-sync", userId);
    evaluatedConditionCount = conditionResults.length;
    createdCount += conditionResults.filter((item) => item.triggered).length;
    createdCount += createPortfolioNotifications(userId);
    createdCount += createWatchlistNotifications(userId, context.watchlistTargets);
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
  const watchlistTargets = db.prepare(`SELECT wi.id,wi.instrument_id,wi.reason,wi.planned_horizon,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM observation_conditions existing
          WHERE existing.watchlist_item_id=wi.id
            AND existing.condition_type='DRAWDOWN_REACH'
        )
        THEN (
          SELECT CAST(ROUND(CAST(active.threshold_decimal AS REAL) * 10000) AS INTEGER)
          FROM observation_conditions active
          WHERE active.watchlist_item_id=wi.id
            AND active.condition_type='DRAWDOWN_REACH'
            AND active.status='active'
          ORDER BY active.created_at,active.id LIMIT 1
        )
        ELSE wi.drawdown_threshold_bps
      END AS drawdown_threshold_bps,
      i.symbol,i.name,i.market,i.asset_type
    FROM watchlist_items wi JOIN watchlists w ON w.id=wi.watchlist_id JOIN instruments i ON i.id=wi.instrument_id
    WHERE w.user_id=? AND w.status='active' AND wi.status='active' ORDER BY wi.added_at DESC`).all(userId) as WatchlistTarget[];
  db.close();
  return { portfolioId: holding?.portfolio_id ?? null, lastMarketRefreshAt: state?.last_market_refresh_at ?? null, watchlistTargets };
}

async function refreshWatchlistMarket(userId: string, targets: WatchlistTarget[]): Promise<void> {
  const grouped = new Map<PandaDataMethod, Set<string>>();
  for (const target of targets) {
    const method = marketMethod(target);
    const symbols = grouped.get(method) ?? new Set<string>();
    symbols.add(canonicalSymbol(target));
    grouped.set(method, symbols);
  }
  if (grouped.size === 0) return;

  const agentRunId = createId("notification_scan");
  const startedAt = isoNow();
  const db = getDatabase();
  db.prepare("INSERT INTO agent_runs (id,user_id,type,status,created_at) VALUES (?,?,?,'running',?)").run(agentRunId, userId, "notification_scan", startedAt);
  const endDate = compactDate(new Date());
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 45);
  let successes = 0;
  const failures: string[] = [];
  for (const [method, symbols] of grouped) {
    const source: PandaQuerySource = {
      dataset: datasetForMethod(method), method,
      parameters: { symbol: [...symbols], start_date: compactDate(start), end_date: endDate, fields: ["symbol", "date", "close", "pre_close"] },
      columns: ["symbol", "date", "close", "pre_close"], joinKeys: ["symbol", "date"], assetType: assetTypeForMethod(method),
    };
    try {
      await executePandaSources({ sources: [source], agentRunId, localRows: [], db: db as SqliteDb });
      successes += 1;
    } catch (error) {
      failures.push(publicError(error, "PANDADATA_UNAVAILABLE", "行情接口暂时不可用。").code);
    }
  }
  const completedAt = isoNow();
  db.prepare("UPDATE agent_runs SET status=?,completed_at=?,failure_code=?,failure_message=? WHERE id=?")
    .run(successes > 0 ? "completed" : "failed", completedAt, failures[0] ?? null, failures.length ? failures.join(",") : null, agentRunId);
  db.close();
  if (successes === 0) throw new Error(failures[0] ?? "PANDADATA_UNAVAILABLE");
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

function isPandaDataConfigured(): boolean {
  return [process.env.DEFAULT_USERNAME, process.env.DEFAULT_PASSWORD, process.env.JAVA_SERVICE_BASE_URL]
    .every((value) => Boolean(value?.trim()) && !/^(?:your_value_here|default_placeholder)$/iu.test(value!.trim()));
}

function marketMethod(target: Pick<WatchlistTarget, "symbol" | "market" | "asset_type">): PandaDataMethod {
  const market = target.market.toUpperCase();
  const assetType = target.asset_type.toLowerCase();
  if (market === "HK" || target.symbol.toUpperCase().endsWith(".HK")) return "get_hk_daily";
  if (["SH", "SZ", "BJ", "CN"].includes(market) || /\.(?:SH|SZ|BJ)$/u.test(target.symbol.toUpperCase()) || /^\d{6}$/u.test(target.symbol)) {
    if (["fund", "etf", "index_fund"].includes(assetType)) return "get_fund_daily";
    if (assetType === "index") return "get_index_daily";
    return "get_stock_daily";
  }
  return "get_us_daily";
}

function datasetForMethod(method: PandaDataMethod): MarketDatasetKey {
  if (method === "get_fund_daily") return "MARKET_FUND_DAILY";
  if (method === "get_index_daily") return "MARKET_INDEX_DAILY";
  if (method === "get_hk_daily") return "MARKET_HK_DAILY";
  if (method === "get_us_daily") return "MARKET_US_DAILY";
  return "MARKET_STOCK_DAILY";
}

function assetTypeForMethod(method: PandaDataMethod): string {
  if (method === "get_fund_daily") return "FUND";
  if (method === "get_index_daily") return "INDEX";
  return "STOCK";
}

function publicError(error: unknown, fallbackCode: string, fallbackMessage: string): { code: string; message: string } {
  if (error && typeof error === "object") {
    const value = error as { code?: unknown; details?: { category?: unknown } };
    return { code: String(value.details?.category ?? value.code ?? fallbackCode).slice(0, 80), message: fallbackMessage };
  }
  return { code: fallbackCode, message: fallbackMessage };
}

function compactDate(value: Date): string {
  return value.toISOString().slice(0, 10).replaceAll("-", "");
}
