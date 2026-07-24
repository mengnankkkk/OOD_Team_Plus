import { NextRequest, NextResponse } from "next/server";

import { getDatabase, getRequestContext, isoNow, meta } from "@/server/http/context";
import { syncPortfolioFromHoldings } from "@/server/extensions/analysis/service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null) as { quantity?: string; cost?: string; openedAt?: string | null } | null;
  const expectedVersion = Number.parseInt(req.headers.get("If-Match")?.replaceAll('"', "") ?? "", 10);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "A numeric If-Match header is required" } }, { status: 400 });
  const db = getDatabase();
  const userId = getRequestContext(req).userId;
  const current = db.prepare("SELECT version FROM holdings WHERE id=? AND user_id=? AND status='active'").get(id, userId) as { version?: number } | undefined;
  if (!current) { db.close(); return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Holding not found" } }, { status: 404 }); }
  const result = db.prepare("UPDATE holdings SET quantity_decimal=COALESCE(?,quantity_decimal), cost_decimal=COALESCE(?,cost_decimal), opened_at=COALESCE(?,opened_at), updated_at=?, version=version+1 WHERE id=? AND user_id=? AND status='active' AND version=?").run(body?.quantity ?? null, body?.cost ?? null, body?.openedAt ?? null, isoNow(), id, userId, expectedVersion);
  if (!result.changes) { db.close(); return NextResponse.json({ error: { code: "VERSION_CONFLICT", message: "Holding was modified", details: { currentVersion: current.version } } }, { status: 412 }); }
  const row = db.prepare("SELECT * FROM holdings WHERE id=?").get(id) as Record<string, unknown>;
  db.close();
  syncPortfolioFromHoldings(userId, String(row.portfolio_id));
  return NextResponse.json({ data: row, meta: meta() });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const db = getDatabase(); const row = db.prepare("SELECT portfolio_id FROM holdings WHERE id=? AND user_id=?").get(id, getRequestContext(req).userId) as { portfolio_id?: string } | undefined; const result = db.prepare("UPDATE holdings SET status='deleted', updated_at=? WHERE id=? AND user_id=? AND status='active'").run(isoNow(), id, getRequestContext(req).userId); db.close(); if (result.changes && row?.portfolio_id) syncPortfolioFromHoldings(getRequestContext(req).userId, row.portfolio_id); return new Response(null, { status: result.changes ? 204 : 404 });
}
