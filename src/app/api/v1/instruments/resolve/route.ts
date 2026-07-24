import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createId, getDatabase, meta } from "@/server/http/context";

const Schema = z.object({
  symbol: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(120),
  assetType: z.enum(["stock", "fund", "index", "bond", "cash", "other"]).default("stock"),
  market: z.string().trim().max(16).optional(),
  sector: z.string().trim().max(80).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Invalid instrument", details: parsed.error.format() } }, { status: 400 });
  }
  const symbol = normalizeSymbol(parsed.data.symbol);
  const name = parsed.data.name.trim();
  const market = parsed.data.market?.trim() || inferMarket(symbol);
  const db = getDatabase();
  try {
    const existing = db.prepare(`
      SELECT id,symbol,name,market,asset_type,sector,tradable
      FROM instruments
      WHERE UPPER(symbol)=UPPER(?)
        OR UPPER(symbol)=UPPER(?)
        OR name=?
      ORDER BY tradable DESC
      LIMIT 1
    `).get(symbol, `${symbol}.${market}`, name) as Record<string, unknown> | undefined;
    if (existing) return NextResponse.json({ data: format(existing), meta: meta() });

    const id = symbol.length === 6 ? `${symbol}.${market}` : createId("instrument");
    db.prepare("INSERT INTO instruments (id,symbol,name,market,asset_type,sector,tradable) VALUES (?,?,?,?,?,?,1)")
      .run(id, symbol, name, market, parsed.data.assetType, parsed.data.sector ?? "A股", 1);
    const row = db.prepare("SELECT id,symbol,name,market,asset_type,sector,tradable FROM instruments WHERE id=?").get(id) as Record<string, unknown>;
    return NextResponse.json({ data: format(row), meta: meta() }, { status: 201 });
  } finally {
    db.close();
  }
}

function normalizeSymbol(value: string): string {
  const trimmed = value.trim().toUpperCase();
  const digits = trimmed.replace(/\D/g, "");
  return digits.length > 0 && digits.length <= 6 ? digits.padStart(6, "0") : trimmed;
}

function inferMarket(symbol: string): string {
  if (symbol.startsWith("6")) return "SH";
  if (symbol.startsWith("8") || symbol.startsWith("9")) return "BJ";
  return "SZ";
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
