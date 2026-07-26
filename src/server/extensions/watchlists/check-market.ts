import type { SqliteDb } from "@/server/db/client.runtime";
import type { WatchlistTarget } from "@/server/extensions/notifications/watchlist-alerts";
import { canonicalSymbol } from "@/server/extensions/notifications/watchlist-alerts";
import type { PandaDataMethod } from "@/server/extensions/pandadata/adapter";
import { executePandaSources } from "@/server/extensions/query/panda-query-executor";
import type { MarketDatasetKey, PandaQuerySource } from "@/server/extensions/query/market-catalog";
import { createId, getDatabase, isoNow } from "@/server/http/context";

type MarketExecutor = typeof executePandaSources;

export type MarketRefreshResult = {
  succeededGroupCount: number;
  failedGroupCount: number;
  complete: boolean;
  errorCode: string | null;
};

export async function refreshScopedWatchlistMarket(
  userId: string,
  targets: WatchlistTarget[],
  execute: MarketExecutor = executePandaSources,
): Promise<MarketRefreshResult> {
  const grouped = groupSymbols(targets);
  if (grouped.size === 0) {
    return { succeededGroupCount: 0, failedGroupCount: 0, complete: true, errorCode: null };
  }
  const agentRunId = createId("notification_scan");
  const startedAt = isoNow();
  const db = getDatabase();
  let successes = 0;
  const failures: string[] = [];
  try {
    db.prepare("INSERT INTO agent_runs (id,user_id,type,status,created_at) VALUES (?,?,?,'running',?)")
      .run(agentRunId, userId, "notification_scan", startedAt);
    const endDate = compactDate(new Date());
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - 45);
    for (const [method, symbols] of grouped) {
      try {
        await execute({
          sources: [marketSource(method, [...symbols], start, endDate)],
          agentRunId,
          localRows: [],
          db: db as SqliteDb,
        });
        successes += 1;
      } catch (error) {
        failures.push(publicErrorCode(error, "PANDADATA_UNAVAILABLE"));
      }
    }
    db.prepare("UPDATE agent_runs SET status=?,completed_at=?,failure_code=?,failure_message=? WHERE id=?")
      .run(failures.length ? "failed" : "completed", isoNow(), failures[0] ?? null,
        failures.length ? failures.join(",") : null, agentRunId);
  } finally {
    db.close();
  }
  return {
    succeededGroupCount: successes,
    failedGroupCount: failures.length,
    complete: failures.length === 0,
    errorCode: failures[0] ?? null,
  };
}

export function latestMarketDataAsOf(instrumentIds: string[]): string | null {
  if (!instrumentIds.length) return null;
  const db = getDatabase();
  try {
    const row = db.prepare(`SELECT MAX(as_of) AS data_as_of FROM market_snapshots
      WHERE instrument_id IN (${instrumentIds.map(() => "?").join(",")})`)
      .get(...instrumentIds) as { data_as_of: string | null };
    return row.data_as_of ?? null;
  } finally {
    db.close();
  }
}

export function isPandaDataConfigured(): boolean {
  return [process.env.DEFAULT_USERNAME, process.env.DEFAULT_PASSWORD, process.env.JAVA_SERVICE_BASE_URL]
    .every((value) => Boolean(value?.trim()) && !/^(?:your_value_here|default_placeholder)$/iu.test(value!.trim()));
}

function marketSource(
  method: PandaDataMethod,
  symbols: string[],
  start: Date,
  endDate: string,
): PandaQuerySource {
  return {
    dataset: datasetForMethod(method),
    method,
    parameters: {
      symbol: symbols,
      start_date: compactDate(start),
      end_date: endDate,
      fields: ["symbol", "date", "close", "pre_close"],
    },
    columns: ["symbol", "date", "close", "pre_close"],
    joinKeys: ["symbol", "date"],
    assetType: assetTypeForMethod(method),
  };
}

function groupSymbols(targets: WatchlistTarget[]): Map<PandaDataMethod, Set<string>> {
  const grouped = new Map<PandaDataMethod, Set<string>>();
  for (const target of targets) {
    const method = marketMethod(target);
    const symbols = grouped.get(method) ?? new Set<string>();
    symbols.add(canonicalSymbol(target));
    grouped.set(method, symbols);
  }
  return grouped;
}

function marketMethod(target: Pick<WatchlistTarget, "symbol" | "market" | "asset_type">): PandaDataMethod {
  const market = target.market.toUpperCase();
  const assetType = target.asset_type.toLowerCase();
  if (market === "HK" || target.symbol.toUpperCase().endsWith(".HK")) return "get_hk_daily";
  if (["SH", "SZ", "BJ", "CN"].includes(market) || /\.(?:SH|SZ|BJ)$/u.test(target.symbol.toUpperCase())
    || /^\d{6}$/u.test(target.symbol)) {
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

function publicErrorCode(error: unknown, fallbackCode: string): string {
  if (error instanceof Error && /^[A-Z0-9_]{3,80}$/u.test(error.message)) return error.message;
  if (error && typeof error === "object") {
    const value = error as { code?: unknown; details?: { category?: unknown } };
    return String(value.details?.category ?? value.code ?? fallbackCode).slice(0, 80);
  }
  return fallbackCode;
}

function compactDate(value: Date): string {
  return value.toISOString().slice(0, 10).replaceAll("-", "");
}
