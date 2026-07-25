import { apiDelete, apiGet, apiPatch, apiPost } from "@/features/frontend-migration/api";
import type { AssetClass, Holding, HoldingInput } from "@/types/app/asset";

type HoldingRow = Record<string, unknown>;
type InstrumentSearchRow = { instrumentId: string; symbol: string; name: string; assetType: string; sector?: string | null; tradable: boolean };

function priceStatus(row: HoldingRow): Holding["priceStatus"] {
  if (row.current_price_decimal == null && row.current_price == null) return "fallback";
  try {
    const statuses = JSON.parse(String(row.price_sources_json ?? "[]")) as Array<{ source?: string; status?: string; symbols?: string[] }>;
    const symbol = String(row.symbol ?? "");
    const hasSuccessfulMarketSource = statuses.some((status) => status.status === "SUCCEEDED" && status.source?.startsWith("PANDADATA:"));
    const usesFallback = statuses.some((status) => status.status === "FALLBACK"
      && status.source === "PREVIOUS_SNAPSHOT"
      && (!status.symbols || status.symbols.includes(symbol)));
    return hasSuccessfulMarketSource && !usesFallback ? "market" : "fallback";
  } catch {
    return "fallback";
  }
}

const toAssetClass = (value: unknown): AssetClass => {
  const normalized = String(value ?? "other").toLowerCase();
  if (normalized === "stock") return "stock";
  if (normalized === "etf" || normalized === "index" || normalized === "index_fund") return "index_fund";
  if (normalized === "fund" || normalized === "equity_fund") return "equity_fund";
  if (normalized === "bond" || normalized === "bond_fund") return "bond_fund";
  if (normalized === "cash" || normalized === "money_market") return normalized as AssetClass;
  return "other";
};

const mapRow = (row: HoldingRow): Holding => {
  const quantity = Number(row.quantity_decimal ?? row.quantity ?? 0);
  const cost = Number(row.cost_decimal ?? row.cost ?? 0);
  const price = Number(row.current_price_decimal ?? row.current_price ?? cost);
  return {
    id: String(row.id),
    userId: String(row.user_id ?? ""),
    accountId: row.portfolio_id == null ? null : String(row.portfolio_id),
    goalId: row.goal_id == null ? null : String(row.goal_id),
    symbol: String(row.symbol ?? ""),
    name: String(row.name ?? row.symbol ?? ""),
    assetClass: toAssetClass(row.asset_type),
    industry: row.sector == null ? null : String(row.sector),
    quantity,
    costBasis: cost,
    currentPrice: price,
    marketValue: Number(row.market_value_decimal ?? quantity * price),
    priceAsOf: row.price_as_of == null ? null : String(row.price_as_of),
    priceStatus: priceStatus(row),
    createdAt: String(row.created_at ?? new Date(0).toISOString()),
    updatedAt: String(row.updated_at ?? row.created_at ?? new Date(0).toISOString()),
  };
};

async function resolveInstrument(input: HoldingInput): Promise<InstrumentSearchRow> {
  const symbol = input.symbol?.trim();
  if (symbol && input.name.trim()) {
    return apiPost<InstrumentSearchRow>("/api/v1/instruments/resolve", {
      symbol,
      name: input.name.trim(),
      assetType: input.assetClass === "index_fund" ? "index" : input.assetClass === "stock" ? "stock" : "fund",
      sector: input.industry ?? undefined,
    });
  }
  const query = encodeURIComponent(symbol || input.name.trim());
  const result = await apiGet<{ items: InstrumentSearchRow[] }>(`/api/v1/instruments/search?q=${query}&limit=20`);
  const exact = result.items.find((item) => item.tradable && (item.symbol.toLowerCase() === symbol?.toLowerCase() || item.name === input.name));
  const match = exact ?? result.items.find((item) => item.tradable);
  if (!match) throw new Error("未找到可交易标的，请先在标的库中确认代码");
  return match;
}

export async function listHoldings(_userId: string, opts?: { page?: number; pageSize?: number }): Promise<Holding[]> {
  const result = await apiGet<{ items: HoldingRow[] }>("/api/v1/holdings");
  const start = (opts?.page ?? 0) * (opts?.pageSize ?? 100);
  return result.items.slice(start, start + (opts?.pageSize ?? 100)).map(mapRow);
}

export async function createHolding(_userId: string, input: HoldingInput): Promise<Holding> {
  if (input.costBasis === undefined || !Number.isFinite(input.costBasis) || input.costBasis < 0) {
    throw new Error("请填写有效的持仓成本价");
  }
  const instrument = await resolveInstrument(input);
  const row = await apiPost<HoldingRow>("/api/v1/holdings", {
    instrumentId: instrument.instrumentId,
    quantity: String(input.quantity),
    cost: String(input.costBasis),
    portfolioId: input.accountId ?? "portfolio-demo",
  });
  return mapRow({ ...row, symbol: instrument.symbol, name: instrument.name, asset_type: instrument.assetType, sector: instrument.sector });
}

export async function updateHolding(userId: string, id: string, changes: Partial<HoldingInput>): Promise<Holding> {
  const rows = await apiGet<{ items: HoldingRow[] }>("/api/v1/holdings");
  const current = rows.items.find((row) => row.id === id);
  if (!current) throw new Error("持仓不存在");
  const row = await apiPatch<HoldingRow>(`/api/v1/holdings/${id}`, {
    quantity: changes.quantity === undefined ? undefined : String(changes.quantity),
    cost: changes.costBasis === undefined ? undefined : String(changes.costBasis),
  }, Number(current.version ?? 1));
  return mapRow({ ...current, ...row, user_id: userId });
}

export async function deleteHolding(_userId: string, id: string): Promise<void> {
  await apiDelete(`/api/v1/holdings/${id}`);
}

export async function refreshHoldingPrices(portfolioId = "portfolio-demo"): Promise<void> {
  await apiPost("/api/v1/portfolio-analysis/refresh", { portfolioId, forceRefresh: true });
}

export async function bulkCreateHoldings(userId: string, inputs: HoldingInput[]): Promise<number> {
  for (const input of inputs) await createHolding(userId, input);
  return inputs.length;
}

export async function parseHoldingsCsv(csvText: string): Promise<HoldingInput[]> {
  const result = await apiPost<{ candidates: Array<Record<string, unknown>> }>("/api/v1/holdings/parse", { text: csvText });
  return result.candidates.filter((candidate) => candidate.instrumentId).map((candidate) => ({
    name: String(candidate.name),
    symbol: String(candidate.symbol ?? ""),
    assetClass: toAssetClass(candidate.assetType),
    quantity: Number(candidate.quantity ?? 0),
    costBasis: Number(candidate.averageCost ?? 0),
  }));
}
