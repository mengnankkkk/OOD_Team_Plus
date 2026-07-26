import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
} from "@/features/frontend-migration/api";
import type {
  WatchlistCheckResult,
  WatchlistItemAggregate,
  WatchlistItemBase,
  WatchlistItemPatch,
  WatchlistItemsAggregate,
  WatchlistPatch,
  WatchlistSummary,
} from "@/server/extensions/watchlists/types";

export type {
  AgentConclusionAggregate,
  Availability,
  IndustryConcentrationAggregate,
  MarketAggregate,
  PortfolioRelationAggregate,
  RiskAggregate,
  ValuationAggregate,
  WatchlistCheckResult,
  WatchlistItemPatch,
  WatchlistItemSource,
  WatchlistPatch,
  WatchlistSummary,
} from "@/server/extensions/watchlists/types";

export type WatchlistStatus = "active" | "archived";

export type WatchlistCreateInput = {
  name: string;
  description?: string | null;
};

export type WatchlistItemCreateInput = {
  instrumentId: string;
  reason?: string;
  plannedHorizon?: string;
  goalId?: string | null;
  initialDrawdownThresholdPct?: number | null;
};

export type WatchlistItemRecord = WatchlistItemBase;

export type WatchlistItem = WatchlistItemAggregate & {
  drawdown_threshold: number | null;
};

export type WatchlistItemsResponse = Omit<WatchlistItemsAggregate, "items"> & {
  items: WatchlistItem[];
};

type VersionedItem = {
  id: string;
  version?: number;
  row_version?: number;
};

type Instrument = {
  instrumentId: string;
  symbol: string;
  name: string;
  market?: string;
  assetType?: string;
  sector?: string | null;
  tradable: boolean;
};

export type WatchlistInstrumentResolveInput = {
  symbol: string;
  name: string;
  market?: string;
  assetType?: "stock" | "fund" | "index" | "bond" | "cash" | "other";
  sector?: string;
};

type LegacyCreateInput = {
  name: string;
  symbol: string;
  reason?: string;
  plannedHorizon?: string;
  drawdownThresholdPct?: number;
};

export async function listWatchlists(
  status: WatchlistStatus = "active",
): Promise<WatchlistSummary[]> {
  const result = await apiGet<{ items: WatchlistSummary[] }>(
    `/api/v1/watchlists?status=${status}&limit=100`,
  );
  return result.items;
}

export function createWatchlist(
  input: WatchlistCreateInput,
): Promise<WatchlistSummary> {
  return apiPost<WatchlistSummary>("/api/v1/watchlists", input);
}

export function updateWatchlist(
  item: WatchlistSummary,
  patch: WatchlistPatch,
): Promise<WatchlistSummary> {
  return apiPatch<WatchlistSummary>(
    `/api/v1/watchlists/${encodeURIComponent(item.id)}`,
    patch,
    item.version,
  );
}

export async function deleteWatchlist(item: WatchlistSummary): Promise<void> {
  await apiDelete(
    `/api/v1/watchlists/${encodeURIComponent(item.id)}`,
    undefined,
    item.version,
  );
}

export function listWatchlistItems(
  watchlistId: string,
): Promise<WatchlistItemsResponse>;
export function listWatchlistItems(): Promise<WatchlistItem[]>;
export async function listWatchlistItems(
  watchlistId?: unknown,
): Promise<WatchlistItem[] | WatchlistItemsResponse> {
  if (typeof watchlistId !== "string") {
    const watchlist = await ensureDefaultWatchlist();
    return (await getWatchlistItems(watchlist.id)).items;
  }
  return getWatchlistItems(watchlistId);
}

export function createWatchlistItem(
  watchlistId: string,
  input: WatchlistItemCreateInput,
): Promise<WatchlistItemRecord> {
  return apiPost<WatchlistItemRecord>(
    `/api/v1/watchlists/${encodeURIComponent(watchlistId)}/items`,
    input,
  );
}

export function resolveWatchlistInstrument(
  input: WatchlistInstrumentResolveInput,
): Promise<Instrument> {
  return apiPost<Instrument>("/api/v1/instruments/resolve", input);
}

export function updateWatchlistItem(
  item: WatchlistItemRecord | WatchlistItem,
  patch: WatchlistItemPatch,
): Promise<WatchlistItemRecord> {
  return apiPatch<WatchlistItemRecord>(
    `/api/v1/watchlist-items/${encodeURIComponent(item.id)}`,
    patch,
    item.version,
  );
}

export function moveWatchlistItem(
  item: WatchlistItemRecord | WatchlistItem,
  targetWatchlistId: string,
): Promise<WatchlistItemRecord> {
  return apiPost<WatchlistItemRecord>(
    `/api/v1/watchlist-items/${encodeURIComponent(item.id)}/move`,
    { targetWatchlistId },
    item.version,
  );
}

export async function removeWatchlistItem(
  item: VersionedItem,
): Promise<void> {
  await apiDelete(
    `/api/v1/watchlist-items/${encodeURIComponent(item.id)}`,
    undefined,
    itemVersion(item),
  );
}

export function checkWatchlist(
  watchlistId: string,
  forceMarketRefresh = true,
): Promise<WatchlistCheckResult> {
  return apiPost<WatchlistCheckResult>(
    `/api/v1/watchlists/${encodeURIComponent(watchlistId)}/check`,
    { forceMarketRefresh },
  );
}

export function checkWatchlistItem(
  itemId: string,
  forceMarketRefresh = true,
): Promise<WatchlistCheckResult> {
  return apiPost<WatchlistCheckResult>(
    `/api/v1/watchlist-items/${encodeURIComponent(itemId)}/check`,
    { forceMarketRefresh },
  );
}

export async function addWatchlistItem(input: LegacyCreateInput): Promise<void> {
  const watchlist = await ensureDefaultWatchlist();
  const instrument = await resolveInstrument(input);
  if (!instrument) {
    throw new Error("未找到可交易标的，请检查代码或名称");
  }
  await createWatchlistItem(watchlist.id, {
    instrumentId: instrument.instrumentId,
    reason: input.reason || undefined,
    plannedHorizon: input.plannedHorizon || undefined,
    initialDrawdownThresholdPct: input.drawdownThresholdPct,
  });
}

async function getWatchlistItems(
  watchlistId: string,
): Promise<WatchlistItemsResponse> {
  const result = await apiGet<WatchlistItemsAggregate>(
    `/api/v1/watchlists/${encodeURIComponent(watchlistId)}/items?limit=100`,
  );
  return {
    ...result,
    items: result.items.map((item) => ({
      ...item,
      drawdown_threshold: item.drawdown_threshold_bps == null
        ? null
        : item.drawdown_threshold_bps / 100,
    })),
  };
}

async function ensureDefaultWatchlist(): Promise<WatchlistSummary> {
  const existing = await listWatchlists();
  const found = existing.find((item) => item.name === "持仓观测") ?? existing[0];
  return found ?? createWatchlist({
    name: "持仓观测",
    description: "由前端持仓观测页面管理",
  });
}

async function resolveInstrument(input: {
  name: string;
  symbol: string;
}): Promise<Instrument | null> {
  const symbol = input.symbol.trim();
  const name = input.name.trim();
  if (symbol && name) {
    return apiPost<Instrument>("/api/v1/instruments/resolve", {
      symbol,
      name,
      assetType: "stock",
    });
  }
  const query = encodeURIComponent(symbol || name);
  const instruments = await apiGet<{ items: Instrument[] }>(
    `/api/v1/instruments/search?q=${query}&limit=20`,
  );
  return instruments.items.find((item) => (
    item.tradable
    && (
      item.symbol.toLowerCase() === symbol.toLowerCase()
      || item.name === name
    )
  )) ?? instruments.items.find((item) => item.tradable) ?? null;
}

function itemVersion(item: VersionedItem): number {
  const version = item.version ?? item.row_version;
  if (!version) throw new Error("Missing watchlist item version");
  return version;
}
