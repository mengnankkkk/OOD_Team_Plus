import { apiDelete, apiGet, apiPost } from "@/features/frontend-migration/api";

export type WatchlistItem = {
  id: string;
  name: string;
  symbol: string;
  reason: string | null;
  planned_horizon: string | null;
  drawdown_threshold: number | null;
  row_version: number;
};

type Watchlist = { id: string; name: string };
type Instrument = { instrumentId: string; symbol: string; name: string; tradable: boolean };

async function ensureDefaultWatchlist(): Promise<Watchlist> {
  const existing = await apiGet<{ items: Watchlist[] }>("/api/v1/watchlists?limit=100");
  const found = existing.items.find((item) => item.name === "持仓观测") ?? existing.items[0];
  return found ?? apiPost<Watchlist>("/api/v1/watchlists", { name: "持仓观测", description: "由前端持仓观测页面管理" });
}

export async function listWatchlistItems(): Promise<WatchlistItem[]> {
  const watchlist = await ensureDefaultWatchlist();
  const result = await apiGet<{ items: Array<Record<string, unknown>> }>(`/api/v1/watchlists/${watchlist.id}/items?limit=100`);
  return result.items.map((row) => ({
    id: String(row.id), name: String(row.name ?? row.symbol ?? ""), symbol: String(row.symbol ?? ""),
    reason: row.reason == null ? null : String(row.reason), planned_horizon: row.planned_horizon == null ? null : String(row.planned_horizon),
    drawdown_threshold: null, row_version: Number(row.row_version ?? 1),
  }));
}

export async function addWatchlistItem(input: { name: string; symbol: string; reason?: string; plannedHorizon?: string }): Promise<void> {
  const watchlist = await ensureDefaultWatchlist();
  const query = encodeURIComponent(input.symbol || input.name);
  const instruments = await apiGet<{ items: Instrument[] }>(`/api/v1/instruments/search?q=${query}&limit=20`);
  const instrument = instruments.items.find((item) => item.tradable && (item.symbol.toLowerCase() === input.symbol.toLowerCase() || item.name === input.name)) ?? instruments.items.find((item) => item.tradable);
  if (!instrument) throw new Error("未找到可交易标的，请检查代码或名称");
  await apiPost(`/api/v1/watchlists/${watchlist.id}/items`, { instrumentId: instrument.instrumentId, reason: input.reason || undefined, plannedHorizon: input.plannedHorizon || undefined });
}

export async function removeWatchlistItem(item: WatchlistItem): Promise<void> {
  await apiDelete(`/api/v1/watchlist-items/${item.id}`, undefined, item.row_version);
}
