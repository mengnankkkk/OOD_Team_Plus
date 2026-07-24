import type { AdvisorDatabase } from "@/server/advisor/database";
import { newId, nowIso, runRows, runValue, runWrite } from "@/server/advisor/store-common";

export class WatchlistStore {
  constructor(private readonly database: AdvisorDatabase) {}

  list(userId: string) {
    return runRows<Record<string, unknown>>(
      this.database,
      `SELECT w.*, i.symbol, i.name, i.instrument_type, i.instrument_subtype, i.market,
       i.currency, i.sector_name, i.is_tradable, i.metadata_json
       FROM watchlist_items w JOIN instruments i ON i.id = w.instrument_id
       WHERE w.user_id = ? ORDER BY w.created_at DESC`,
      userId,
    ).map(mapItem);
  }

  add(userId: string, instrumentId: string, note?: string) {
    const instrument = runValue<{ id: string }>(this.database, "SELECT id FROM instruments WHERE id = ?", instrumentId);
    if (!instrument) throw new Error("RESOURCE_NOT_FOUND");
    const existing = runValue<{ id: string }>(
      this.database,
      "SELECT id FROM watchlist_items WHERE user_id = ? AND instrument_id = ?",
      userId,
      instrumentId,
    );
    if (existing) return this.list(userId).find((item) => item.id === existing.id)!;
    const id = newId("watchlist");
    const timestamp = nowIso();
    runWrite(
      this.database,
      "INSERT INTO watchlist_items(id, user_id, instrument_id, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      userId,
      instrumentId,
      note ?? null,
      timestamp,
      timestamp,
    );
    return this.list(userId).find((item) => item.id === id)!;
  }

  update(userId: string, id: string, note?: string) {
    const result = runWrite(
      this.database,
      "UPDATE watchlist_items SET note = ?, updated_at = ? WHERE id = ? AND user_id = ?",
      note ?? null,
      nowIso(),
      id,
      userId,
    );
    return result.changes > 0 ? this.list(userId).find((item) => item.id === id) ?? null : null;
  }

  remove(userId: string, id: string) {
    return runWrite(this.database, "DELETE FROM watchlist_items WHERE id = ? AND user_id = ?", id, userId).changes > 0;
  }
}

function mapItem(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    note: row.note as string | null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    instrument: {
      id: String(row.instrument_id),
      symbol: String(row.symbol),
      name: String(row.name),
      assetType: assetType(row.instrument_type, row.instrument_subtype),
      instrumentSubtype: row.instrument_subtype ? String(row.instrument_subtype).toUpperCase() : null,
      market: String(row.market).toUpperCase(),
      currency: String(row.currency),
      sectorName: row.sector_name as string | null,
      tradable: Number(row.is_tradable) === 1,
      metadata: parseMetadata(row.metadata_json),
    },
  };
}

function assetType(type: unknown, subtype: unknown) {
  const normalizedType = String(type).toUpperCase();
  const normalizedSubtype = String(subtype ?? "").toUpperCase();
  if (normalizedSubtype === "GOLD_ETF") return "GOLD_ETF";
  if (normalizedSubtype === "INDEX_FUND") return "INDEX_FUND";
  return normalizedType === "FUND" ? "INDEX_FUND" : normalizedType;
}

function parseMetadata(value: unknown) {
  if (typeof value !== "string") return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}
