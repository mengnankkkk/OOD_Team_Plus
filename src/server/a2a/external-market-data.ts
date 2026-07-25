import { callPandaData, type PandaDataMethod } from "@/server/extensions/pandadata/adapter";
import { getDatabase } from "@/server/http/context";

import { A2APublicError, type ExternalPortfolio } from "./contracts";

type MarketCall = typeof callPandaData;
type InstrumentRow = {
  id: string;
  symbol: string;
  market: string;
  asset_type: string;
};

export type ResolvedExternalHolding = {
  instrumentId: string;
  symbol: string;
  quantity: string;
  cost: string;
  price: string;
  priceSource: "PANDADATA";
  dataAsOf: string;
  market: string;
  assetType: string;
};

export async function resolveExternalPortfolio(
  input: ExternalPortfolio,
  options: { call?: MarketCall } = {},
): Promise<{ cash: string; holdings: ResolvedExternalHolding[]; dataAsOf: string }> {
  const call = options.call ?? callPandaData;
  const instruments = input.holdings.map((holding) => resolveInstrument(holding.symbol));
  const holdings = await Promise.all(input.holdings.map(async (holding, index) => {
    const instrument = instruments[index];
    const quote = await resolveQuote(instrument, call);
    return {
      instrumentId: instrument.id,
      symbol: instrument.symbol,
      quantity: holding.quantity,
      cost: holding.cost,
      price: quote.price,
      priceSource: "PANDADATA" as const,
      dataAsOf: quote.dataAsOf,
      market: instrument.market,
      assetType: instrument.asset_type,
    };
  }));
  return {
    cash: input.cash,
    holdings,
    dataAsOf: holdings.map((holding) => holding.dataAsOf).sort().at(0) ?? today(),
  };
}

function resolveInstrument(symbol: string): InstrumentRow {
  const db = getDatabase();
  try {
    const row = db.prepare(`SELECT id,symbol,market,asset_type FROM instruments
      WHERE UPPER(symbol)=UPPER(?) AND tradable=1 LIMIT 1`).get(symbol) as InstrumentRow | undefined;
    if (!row) {
      throw new A2APublicError(
        "INSTRUMENT_NOT_RESOLVED",
        422,
        `Instrument '${symbol}' could not be resolved`,
      );
    }
    return row;
  } finally {
    db.close();
  }
}

async function resolveQuote(
  instrument: InstrumentRow,
  call: MarketCall,
): Promise<{ price: string; dataAsOf: string }> {
  const preferred = methodFor(instrument);
  const methods = preferred === "get_stock_rt_daily"
    ? ["get_stock_rt_daily", "get_stock_daily"] as const
    : [preferred];
  for (const method of methods) {
    try {
      const result = await call(method, parametersFor(method, instrument.symbol));
      const quote = latestQuote(result.data, instrument.symbol, result.asOfDate);
      if (quote && result.fresh !== false) return quote;
    } catch {
      // Try the historical fallback for mainland equities.
    }
  }
  throw new A2APublicError(
    "DATA_SOURCE_UNAVAILABLE",
    503,
    `Current market data is unavailable for '${instrument.symbol}'`,
  );
}

function methodFor(instrument: InstrumentRow): PandaDataMethod {
  const market = instrument.market.toUpperCase();
  const assetType = instrument.asset_type.toLowerCase();
  if (market.includes("HK") || instrument.symbol.toUpperCase().endsWith(".HK")) return "get_hk_daily";
  if (market.includes("SH") || market.includes("SZ") || market.includes("CN")) {
    if (assetType.includes("fund") || assetType.includes("etf")) return "get_fund_daily";
    if (assetType.includes("index")) return "get_index_daily";
    return "get_stock_rt_daily";
  }
  return "get_us_daily";
}

function parametersFor(method: PandaDataMethod, symbol: string): Record<string, unknown> {
  const fields = ["symbol", "date", "trade_date", "close", "price", "last_price"];
  if (method === "get_stock_rt_daily") return { symbol: [symbol], fields };
  const end = compactDate(new Date());
  const start = compactDate(new Date(Date.now() - 10 * 86_400_000));
  return { symbol: [symbol], start_date: start, end_date: end, fields };
}

function latestQuote(
  rows: Array<Record<string, unknown>>,
  symbol: string,
  fallbackDate: string | null,
): { price: string; dataAsOf: string } | null {
  return rows
    .filter((row) => {
      const rowSymbol = String(row.symbol ?? row.code ?? "").toUpperCase();
      return !rowSymbol || rowSymbol === symbol.toUpperCase();
    })
    .map((row) => ({
      price: positiveDecimal(row.close ?? row.price ?? row.last_price),
      dataAsOf: normalizeDate(row.date ?? row.trade_date) ?? fallbackDate ?? today(),
    }))
    .filter((quote): quote is { price: string; dataAsOf: string } => Boolean(quote.price))
    .sort((left, right) => left.dataAsOf.localeCompare(right.dataAsOf))
    .at(-1) ?? null;
}

function positiveDecimal(value: unknown): string | null {
  const text = typeof value === "number" || typeof value === "string" ? String(value).trim() : "";
  const parsed = Number(text);
  return text && Number.isFinite(parsed) && parsed > 0 ? text : null;
}

function normalizeDate(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/gu, "");
  return digits.length >= 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : null;
}

function compactDate(value: Date): string {
  return value.toISOString().slice(0, 10).replaceAll("-", "");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
