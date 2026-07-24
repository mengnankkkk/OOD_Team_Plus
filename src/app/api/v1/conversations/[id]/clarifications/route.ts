import { NextRequest, NextResponse } from "next/server";

import { getDatabase, getRequestContext, meta, parseJson } from "@/server/http/context";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const status = req.nextUrl.searchParams.get("status")?.toLowerCase();
  if (status && !["pending", "answered", "expired"].includes(status)) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid clarification status" } }, { status: 422 });
  const db = getDatabase();
  const userId = getRequestContext(req).userId;
  if (!db.prepare("SELECT id FROM conversation_sessions WHERE id=? AND user_id=?").get(id, userId)) { db.close(); return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Conversation not found" } }, { status: 404 }); }
  const rows = (status ? db.prepare("SELECT * FROM information_requests WHERE session_id=? AND user_id=? AND status=? ORDER BY created_at DESC").all(id, userId, status) : db.prepare("SELECT * FROM information_requests WHERE session_id=? AND user_id=? ORDER BY created_at DESC").all(id, userId)) as Array<Record<string, unknown>>;
  db.close();
  return NextResponse.json({ data: { items: rows.map((row) => ({ id: row.id, analysisId: row.analysis_id, prompt: row.prompt, blocking: row.status === "pending", fields: parseJson(row.fields_json as string, []), status: String(row.status).toUpperCase(), answers: parseJson(row.answers_json as string | null, null), createdAt: row.created_at, answeredAt: row.answered_at, expiresAt: row.expires_at })) }, meta: meta() });
}
