import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { runConversationAgent } from "@/server/extensions/advisor/service";
import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";
import { getDatabase, getRequestContext, idempotencyKey, meta } from "@/server/http/context";

const Schema = z.object({
  clientMessageId: z.string().max(128).optional(),
  content: z.string().min(1).max(4000),
  outputMode: z.enum(["SQL_ONLY", "CHART", "FINANCIAL_REPORT"]).optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDatabase();
  const owns = db.prepare("SELECT id FROM conversation_sessions WHERE id=? AND user_id=?").get(id, getRequestContext(req).userId);
  if (!owns) {
    db.close();
    return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Conversation not found" } }, { status: 404 });
  }
  const rows = db.prepare("SELECT * FROM messages WHERE session_id=? ORDER BY created_at ASC").all(id);
  db.close();
  return NextResponse.json({ data: { items: rows }, meta: meta() });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid message", details: parsed.error.format() } }, { status: 422 });
  const key = idempotencyKey(req);
  if (!key) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key header required" } }, { status: 400 });
  const { userId } = getRequestContext(req);
  const idem = await beginIdempotentRequest(userId, `conversation_message:${id}`, key, parsed.data);
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  try {
    const result = await runConversationAgent({ userId, sessionId: id, ...parsed.data });
    const payload = { data: result, meta: meta() };
    await saveIdempotentResponse(userId, `conversation_message:${id}`, key, idem.requestHash, payload);
    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Conversation analysis failed";
    const status = message === "Conversation not found" ? 404 : message === "IDEMPOTENCY_CONFLICT" || message === "RUN_ALREADY_ACTIVE" ? 409 : 502;
    return NextResponse.json({ error: { code: status === 404 ? "RESOURCE_NOT_FOUND" : status === 409 ? message : "ADVISOR_RUN_FAILED", message, retryable: status >= 500 } }, { status });
  }
}
