import type { PandaDataMethod } from "@/server/extensions/pandadata/adapter";

import type { QueryPlan, QuerySource } from "./types";

export const MARKET_DATASETS = {
  MARKET_STOCK_DAILY: { method: "get_stock_daily", assetType: "STOCK" },
  MARKET_FUND_DAILY: { method: "get_fund_daily", assetType: "FUND" },
  MARKET_INDEX_DAILY: { method: "get_index_daily", assetType: "INDEX" },
  MARKET_US_DAILY: { method: "get_us_daily", assetType: "STOCK" },
  MARKET_HK_DAILY: { method: "get_hk_daily", assetType: "STOCK" },
} as const satisfies Record<string, { method: PandaDataMethod; assetType: string }>;

export type MarketDatasetKey = keyof typeof MARKET_DATASETS;

export interface PandaQuerySource {
  dataset: MarketDatasetKey;
  method: PandaDataMethod;
  parameters: Record<string, unknown>;
  columns: string[];
  joinKeys: string[];
  assetType: string;
}

const DEFAULT_COLUMNS = ["symbol", "date", "open", "high", "low", "close", "volume", "amount"];

export function isMarketDataset(value: string): value is MarketDatasetKey {
  return Object.prototype.hasOwnProperty.call(MARKET_DATASETS, value);
}

export function buildPandaQuerySource(
  question: string,
  dataset: MarketDatasetKey,
  timeRange?: QueryPlan["timeRange"],
): PandaQuerySource {
  const definition = MARKET_DATASETS[dataset];
  const symbols = extractSymbols(question);
  const dates = normalizeDateRange(timeRange);
  const parameters: Record<string, unknown> = {
    start_date: dates.from,
    end_date: dates.to,
    fields: DEFAULT_COLUMNS,
  };
  if (symbols.length) parameters.symbol = symbols;
  return {
    dataset,
    method: definition.method,
    parameters,
    columns: DEFAULT_COLUMNS,
    joinKeys: ["symbol", "date"],
    assetType: definition.assetType,
  };
}

export function asQuerySource(source: PandaQuerySource): QuerySource {
  return {
    dataset: source.dataset,
    kind: "PANDADATA",
    provider: "PANDADATA",
    method: source.method,
    parameters: source.parameters,
    columns: source.columns,
    joinKeys: source.joinKeys,
  };
}

export function extractSymbols(question: string): string[] {
  const suffixed = question.toUpperCase().match(/\b(?:\d{6}\.(?:SH|SZ|OF)|\d{5}\.HK|[A-Z][A-Z0-9.-]{0,9}\.(?:US|HK))\b/gu) ?? [];
  const explicitUppercase = question.match(/\b[A-Z][A-Z0-9.-]{0,9}\b/gu) ?? [];
  const candidates = [...suffixed, ...explicitUppercase];
  const ignored = new Set(["SQL", "ETF", "AI", "A", "B", "C", "SUM", "COUNT", "TOTAL", "SH", "SZ", "OF", "US", "HK"]);
  return [...new Set(candidates.filter((value) => !ignored.has(value)))].slice(0, 50);
}

function normalizeDateRange(timeRange?: QueryPlan["timeRange"]): { from: string; to: string } {
  const end = timeRange?.to ? compactDate(timeRange.to) : compactDate(new Date().toISOString());
  const startDate = new Date(`${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6, 8)}T00:00:00Z`);
  startDate.setUTCDate(startDate.getUTCDate() - 90);
  const from = timeRange?.from ? compactDate(timeRange.from) : compactDate(startDate.toISOString());
  return { from, to: end };
}

function compactDate(value: string): string {
  const digits = value.replace(/\D/gu, "");
  if (digits.length < 8) throw new Error(`Invalid market data date: ${value}`);
  return digits.slice(0, 8);
}
