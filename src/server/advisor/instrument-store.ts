import type { AdvisorDatabase } from "@/server/advisor/database";
import { json, newId, nowIso, parseJson, runRows, runValue, runWrite } from "@/server/advisor/store-common";

export type InstrumentRecord = {
  id: string;
  symbol: string;
  name: string;
  market: string;
  assetType: string;
  instrumentSubtype: string | null;
  currency: string;
  sectorName: string | null;
  tradable: boolean;
  metadata: Record<string, unknown>;
};

export class InstrumentStore {
  constructor(private readonly database: AdvisorDatabase) {}

  search(query: string, assetType?: string) {
    const like = `%${query.toLowerCase()}%`;
    const rows = runRows<Record<string, unknown>>(
      this.database,
      `SELECT DISTINCT i.* FROM instruments i LEFT JOIN instrument_aliases a ON a.instrument_id = i.id
       WHERE lower(i.name) LIKE ? OR lower(i.symbol) LIKE ? OR lower(a.alias) LIKE ?
       ORDER BY i.is_tradable DESC, i.name LIMIT 20`,
      like,
      like,
      like,
    );
    return rows.filter((row) => !assetType || String(row.instrument_type).toUpperCase() === assetType).map(mapInstrument);
  }

  get(idOrSymbol: string) {
    const row = runValue<Record<string, unknown>>(
      this.database,
      "SELECT * FROM instruments WHERE id = ? OR symbol = ?",
      idOrSymbol,
      idOrSymbol,
    );
    return row ? mapInstrument(row) : null;
  }

  upsert(input: Record<string, unknown>) {
    const id = String(input.id ?? newId("instrument"));
    const timestamp = nowIso();
    runWrite(
      this.database,
      `INSERT INTO instruments
       (id, symbol, name, instrument_type, instrument_subtype, market, currency, sector_name,
        is_tradable, status, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
       ON CONFLICT(market, symbol) DO UPDATE SET name=excluded.name, metadata_json=excluded.metadata_json, updated_at=excluded.updated_at`,
      id,
      input.symbol,
      input.name,
      lower(input.assetType ?? input.instrumentType ?? "stock"),
      lower(input.instrumentSubtype ?? null),
      lower(input.market ?? "cn"),
      input.currency ?? "CNY",
      input.sectorName ?? null,
      input.tradable === false ? 0 : 1,
      json(input.metadata ?? {}),
      timestamp,
      timestamp,
    );
    const instrument = this.get(String(input.symbol));
    if (!instrument) throw new Error("INSTRUMENT_CREATE_FAILED");
    return instrument;
  }
}

function mapInstrument(row: Record<string, unknown>): InstrumentRecord {
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    name: String(row.name),
    market: String(row.market).toUpperCase(),
    assetType: assetType(row.instrument_type, row.instrument_subtype),
    instrumentSubtype: row.instrument_subtype ? String(row.instrument_subtype).toUpperCase() : null,
    currency: String(row.currency),
    sectorName: row.sector_name as string | null,
    tradable: Number(row.is_tradable) === 1,
    metadata: parseJson(row.metadata_json, {}),
  };
}

function lower(value: unknown) {
  return value == null ? null : String(value).toLowerCase();
}

function assetType(type: unknown, subtype: unknown) {
  const normalizedType = String(type).toUpperCase();
  const normalizedSubtype = subtype == null ? "" : String(subtype).toUpperCase();
  if (normalizedSubtype === "GOLD_ETF") return "GOLD_ETF";
  if (normalizedSubtype === "INDEX_FUND") return "INDEX_FUND";
  if (normalizedType === "FUND") return "INDEX_FUND";
  return normalizedType;
}
