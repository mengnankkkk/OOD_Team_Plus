import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { startConversationAgent } from "@/server/extensions/advisor/service";
import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";
import { getRequestContext, idempotencyKey, meta } from "@/server/http/context";

const Schema = z.object({
  clientMessageId: z.string().max(128).optional(),
  content: z.string().min(1).max(4000),
  outputMode: z.enum(["SQL_ONLY", "CHART", "FINANCIAL_REPORT"]).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid message", details: parsed.error.format() } }, { status: 422 });
  const key = idempotencyKey(req);
  if (!key) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key header required" } }, { status: 400 });
  const { userId } = getRequestContext(req);
  const idem = await beginIdempotentRequest(userId, `conversation_message_stream:${id}`, key, parsed.data);
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  try {
    const started = startConversationAgent({ userId, sessionId: id, ...parsed.data });
    const payload = { data: started.result, meta: meta() };
    await saveIdempotentResponse(userId, `conversation_message_stream:${id}`, key, idem.requestHash, payload);
    return NextResponse.json(payload, { status: started.replayed ? 200 : 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Conversation analysis failed";
    const status = message === "Conversation not found" ? 404 : message === "IDEMPOTENCY_CONFLICT" || message === "RUN_ALREADY_ACTIVE" ? 409 : 502;
    return NextResponse.json({ error: { code: status === 404 ? "RESOURCE_NOT_FOUND" : status === 409 ? message : "ADVISOR_RUN_FAILED", message, retryable: status >= 500 } }, { status });
  }
}
