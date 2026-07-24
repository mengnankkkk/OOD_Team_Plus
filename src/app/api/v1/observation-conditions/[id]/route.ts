import { NextRequest, NextResponse } from "next/server";

import { getDatabase, getRequestContext, isoNow, meta } from "@/server/http/context";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null) as { threshold?: string; status?: "ACTIVE" | "PAUSED" } | null;
  const expectedVersion = Number.parseInt(req.headers.get("If-Match")?.replaceAll('"', "") ?? "", 10);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "A numeric If-Match header is required" } }, { status: 400 });
  const db = getDatabase();
  const userId = getRequestContext(req).userId;
  const current = db.prepare("SELECT version FROM observation_conditions WHERE id=? AND user_id=?").get(id, userId) as { version?: number } | undefined;
  if (!current) { db.close(); return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Observation condition not found" } }, { status: 404 }); }
  const result = db.prepare("UPDATE observation_conditions SET threshold_decimal = COALESCE(?, threshold_decimal), status = COALESCE(?, status), updated_at = ?, version=version+1 WHERE id = ? AND user_id = ? AND version=?").run(body?.threshold ?? null, body?.status?.toLowerCase() ?? null, isoNow(), id, userId, expectedVersion);
  if (!result.changes) { db.close(); return NextResponse.json({ error: { code: "VERSION_CONFLICT", message: "Observation condition was modified", details: { currentVersion: current.version } } }, { status: 412 }); }
  const row = db.prepare("SELECT * FROM observation_conditions WHERE id = ?").get(id);
  db.close();
  return NextResponse.json({ data: row, meta: meta() });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDatabase();
  const result = db.prepare("UPDATE observation_conditions SET status = 'deleted', updated_at = ? WHERE id = ? AND user_id = ?").run(isoNow(), id, getRequestContext(req).userId);
  db.close();
  return new Response(null, { status: result.changes ? 204 : 404 });
}
