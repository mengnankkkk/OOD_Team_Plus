import { NextRequest, NextResponse } from "next/server";

import { getDatabase, getRequestContext, isoNow, meta } from "@/server/http/context";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null) as Record<string, string | null> | null;
  const db = getDatabase();
  const current = db.prepare("SELECT version FROM goals WHERE id = ? AND user_id = ? AND status = 'active'").get(id, getRequestContext(req).userId) as { version?: number } | undefined;
  if (!current) { db.close(); return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Goal not found" } }, { status: 404 }); }
  const expectedVersion = Number.parseInt(req.headers.get("If-Match")?.replaceAll('"', "") ?? "", 10);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) { db.close(); return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "A numeric If-Match header is required" } }, { status: 400 }); }
  const result = db.prepare(`UPDATE goals SET name=COALESCE(?,name), target_amount_decimal=COALESCE(?,target_amount_decimal), target_date=COALESCE(?,target_date), horizon=COALESCE(?,horizon), priority=COALESCE(?,priority), asset_preference=COALESCE(?,asset_preference), version=version+1, updated_at=? WHERE id=? AND user_id=? AND version=?`).run(body?.name ?? null, body?.targetAmount ?? null, body?.targetDate ?? null, body?.horizon ?? null, body?.priority ?? null, body?.assetPreference ?? null, isoNow(), id, getRequestContext(req).userId, expectedVersion);
  if (!result.changes) { db.close(); return NextResponse.json({ error: { code: "VERSION_CONFLICT", message: "Goal was modified", details: { currentVersion: current.version } } }, { status: 412 }); }
  const row = db.prepare("SELECT * FROM goals WHERE id=?").get(id); db.close();
  return NextResponse.json({ data: row, meta: meta() });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const db = getDatabase();
  const result = db.prepare("UPDATE goals SET status='deleted', updated_at=?, version=version+1 WHERE id=? AND user_id=? AND status='active'").run(isoNow(), id, getRequestContext(req).userId); db.close();
  return new Response(null, { status: result.changes ? 204 : 404 });
}
