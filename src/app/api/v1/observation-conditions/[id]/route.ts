import { NextRequest, NextResponse } from "next/server";

import { getDatabase, getRequestContext, isoNow, meta } from "@/server/http/context";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null) as { threshold?: string; status?: "ACTIVE" | "PAUSED" } | null;
  const db = getDatabase();
  const result = db.prepare("UPDATE observation_conditions SET threshold_decimal = COALESCE(?, threshold_decimal), status = COALESCE(?, status), updated_at = ? WHERE id = ? AND user_id = ?").run(body?.threshold ?? null, body?.status?.toLowerCase() ?? null, isoNow(), id, getRequestContext(req).userId);
  if (!result.changes) { db.close(); return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Observation condition not found" } }, { status: 404 }); }
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
