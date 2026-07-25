import { NextRequest, NextResponse } from "next/server";
import { getDatabase, meta } from "@/server/http/context";

export async function GET(req: NextRequest) {
  const query = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const contains = `%${query}%`;
  const prefix = `${query}%`;
  const requestedLimit = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10);
  const requestedCursor = Number.parseInt(req.nextUrl.searchParams.get("cursor") ?? "0", 10);
  const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 20, 100));
  const offset = Math.max(0, Number.isFinite(requestedCursor) ? requestedCursor : 0);
  const db = getDatabase();

  try {
    const countRow = db.prepare(`
      SELECT COUNT(*) AS total
      FROM instruments
      WHERE symbol LIKE ? OR name LIKE ?
    `).get(contains, contains) as { total: number };
    const rows = db.prepare(`
      SELECT id, symbol, name, market, asset_type, sector, tradable
      FROM instruments
      WHERE symbol LIKE ? OR name LIKE ?
      ORDER BY
        CASE
          WHEN UPPER(symbol) = UPPER(?) THEN 0
          WHEN name = ? THEN 1
          WHEN name LIKE ? THEN 2
          WHEN UPPER(symbol) LIKE UPPER(?) THEN 3
          ELSE 4
        END,
        CASE
          WHEN LOWER(asset_type) = 'stock' THEN 0
          WHEN LOWER(asset_type) IN ('etf', 'index', 'fund') THEN 1
          ELSE 2
        END,
        LENGTH(name),
        symbol
      LIMIT ? OFFSET ?
    `).all(contains, contains, query, query, prefix, prefix, limit, offset) as Array<Record<string, unknown>>;
    const total = Number(countRow.total);
    const nextOffset = offset + rows.length;
    const hasMore = nextOffset < total;
    const pagination = {
      limit,
      nextCursor: hasMore ? String(nextOffset) : null,
      hasMore,
      total,
    };

    return NextResponse.json({
      data: { items: rows.map(format), pagination },
      meta: meta({ pagination }),
    });
  } finally {
    db.close();
  }
}

function format(row: Record<string, unknown>) {
  return {
    instrumentId: row.id,
    symbol: row.symbol,
    name: row.name,
    market: row.market,
    assetType: String(row.asset_type).toUpperCase(),
    sector: row.sector,
    tradable: Boolean(row.tradable),
  };
}
