import { NextRequest, NextResponse } from "next/server";

import { getDatabase, getRequestContext, isoNow, meta } from "@/server/http/context";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; const db = getDatabase(); const row = db.prepare("SELECT * FROM conversation_sessions WHERE id=? AND user_id=?").get(id, getRequestContext(req).userId); if (!row) { db.close(); return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Conversation not found" } }, { status: 404 }); } const messages = db.prepare("SELECT * FROM messages WHERE session_id=? ORDER BY created_at ASC").all(id); db.close(); return NextResponse.json({ data: { ...row as Record<string, unknown>, messages }, meta: meta() }); }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null) as { title?: string; status?: "ACTIVE" | "ARCHIVED" } | null;
  const expectedVersion = Number.parseInt(req.headers.get("If-Match")?.replaceAll('"', "") ?? "", 10);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "A numeric If-Match header is required" } }, { status: 400 });
  if (!body || (body.title === undefined && body.status === undefined) || (body.status !== undefined && body.status !== "ACTIVE" && body.status !== "ARCHIVED") || (body.title !== undefined && (typeof body.title !== "string" || body.title.trim().length === 0 || body.title.trim().length > 120))) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid conversation update" } }, { status: 422 });
  const db = getDatabase();
  const userId = getRequestContext(req).userId;
  const result = db.prepare("UPDATE conversation_sessions SET title=COALESCE(?,title), status=COALESCE(?,status), updated_at=?, row_version=row_version+1 WHERE id=? AND user_id=? AND row_version=?").run(body.title?.trim() ?? null, body.status?.toLowerCase() ?? null, isoNow(), id, userId, expectedVersion);
  if (!result.changes) {
    const current = db.prepare("SELECT row_version FROM conversation_sessions WHERE id=? AND user_id=?").get(id, userId) as { row_version?: number } | undefined;
    db.close();
    if (!current) return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Conversation not found" } }, { status: 404 });
    return NextResponse.json({ error: { code: "VERSION_CONFLICT", message: "Conversation was modified", details: { currentVersion: current.row_version } } }, { status: 412 });
  }
  const row = db.prepare("SELECT * FROM conversation_sessions WHERE id=? AND user_id=?").get(id, userId);
  db.close();
  return NextResponse.json({ data: row, meta: meta() });
}
