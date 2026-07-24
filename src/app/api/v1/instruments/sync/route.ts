import { NextRequest, NextResponse } from "next/server";

import { getRequestContext, getDatabase, isoNow, meta } from "@/server/http/context";
import { callPandaData, type PandaDataMethod } from "@/server/extensions/pandadata/adapter";

type CatalogSource = {
  method: Extract<PandaDataMethod, "get_stock_detail" | "get_fund_detail" | "get_index_detail" | "get_hk_detail" | "get_us_detail">;
  assetType: string;
  parameters: Record<string, unknown>;
};

const SOURCES: CatalogSource[] = [
  { method: "get_stock_detail", assetType: "stock", parameters: { status: 1, fields: ["symbol", "name", "status", "sector_code_name", "board_type"] } },
  { method: "get_fund_detail", assetType: "fund", parameters: { status: "L", fund_status: "A", fields: ["symbol", "name", "trade_name", "exchange", "type", "index_fund_type", "etf_lof_type", "fund_status", "index_name"] } },
  { method: "get_index_detail", assetType: "index", parameters: { status: 1, fields: ["symbol", "name", "abbrev_symbol", "status"] } },
  { method: "get_hk_detail", assetType: "stock", parameters: { status: 1, fields: ["symbol", "name", "cn_name", "economic_sector", "industry_group", "board_type"] } },
  { method: "get_us_detail", assetType: "stock", parameters: { status: 1, fields: ["symbol", "name", "local_name", "economic_sector", "industry_group", "exchange_name"] } },
];

export async function POST(req: NextRequest) {
  getRequestContext(req);
  const startedAt = Date.now();
  const db = getDatabase();
  const upsert = db.prepare("SELECT id FROM instruments WHERE UPPER(symbol)=UPPER(?) LIMIT 1");
  const update = db.prepare("UPDATE instruments SET name=?,market=?,asset_type=?,sector=?,tradable=? WHERE id=?");
  const insert = db.prepare("INSERT INTO instruments (id,symbol,name,market,asset_type,sector,tradable) VALUES (?,?,?,?,?,?,?)");
  const summary: Array<{ method: string; rows: number; error?: string }> = [];
  let imported = 0;
  try {
    const fetched = await Promise.all(SOURCES.map(async (source) => {
      try {
        const result = await callPandaData(source.method, source.parameters, { timeoutMs: 120_000 });
        return { source, rows: result.data };
      } catch (error) {
        return { source, rows: [], error: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240) };
      }
    }));
    for (const { source, rows, error } of fetched) {
      if (error) {
        summary.push({ method: source.method, rows: 0, error });
        continue;
      }
      try {
        const write = db.transaction(() => {
          for (const row of rows) {
            const symbol = text(row.symbol);
            if (!symbol) continue;
            const name = text(row.name) || text(row.cn_name) || text(row.local_name) || symbol;
            const market = marketFor(symbol, source.method, row);
            const assetType = source.method === "get_fund_detail" ? fundAssetType(row) : source.assetType;
            const sector = text(row.sector_code_name) || text(row.economic_sector) || text(row.industry_group) || text(row.index_name) || null;
            const tradable = source.method === "get_index_detail" ? 0 : 1;
            const existing = upsert.get(symbol) as { id?: string } | undefined;
            if (existing?.id) update.run(name, market, assetType, sector, tradable, existing.id);
            else insert.run(symbol, symbol, name, market, assetType, sector, tradable);
            imported += 1;
          }
        });
        write();
        summary.push({ method: source.method, rows: rows.length });
      } catch (error) {
        summary.push({ method: source.method, rows: 0, error: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240) });
      }
    }
    return NextResponse.json({ data: { imported, summary, durationMs: Date.now() - startedAt, syncedAt: isoNow() }, meta: meta() });
  } finally {
    db.close();
  }
}

function text(value: unknown): string | null {
  const result = String(value ?? "").trim();
  return result && result !== "nan" && result !== "None" ? result : null;
}

function marketFor(symbol: string, method: CatalogSource["method"], row: Record<string, unknown>): string {
  if (method === "get_hk_detail") return "HK";
  if (method === "get_us_detail") return text(row.exchange_name) || "US";
  if (method === "get_fund_detail") return text(row.exchange) || symbol.split(".").at(-1) || "OF";
  return symbol.split(".").at(-1) || "CN";
}

function fundAssetType(row: Record<string, unknown>): string {
  const etf = text(row.etf_lof_type);
  if (etf === "ETF" || etf === "LOF" || text(row.index_fund_type) === "I" || text(row.index_fund_type) === "EI") return "index";
  const type = text(row.type);
  if (type === "B") return "bond";
  if (type === "M") return "money_market";
  return "fund";
}
