import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { startDebate } from "@/server/extensions/debate/service";
import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";
import { getRequestContext, idempotencyKey, meta } from "@/server/http/context";

const CreateDebateSchema = z.object({
  conversationId: z.string().min(1),
  message: z.string().min(1).max(4000),
  targetSymbol: z.string().max(32).optional(),
  initialUserRole: z.enum(["neutral", "bull", "bear"]).default("neutral"),
});

export async function POST(req: NextRequest) {
  const parsed = CreateDebateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid debate request", details: parsed.error.format() } }, { status: 422 });
  const key = idempotencyKey(req);
  if (!key) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } }, { status: 400 });
  const { userId } = getRequestContext(req);
  const idem = await beginIdempotentRequest(userId, "debate_create", key, parsed.data);
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  try {
    const result = await startDebate({ userId, ...parsed.data });
    const payload = { data: result, meta: meta() };
    await saveIdempotentResponse(userId, "debate_create", key, idem.requestHash, payload);
    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Debate failed";
    const status = message === "Conversation not found" ? 404 : 502;
    return NextResponse.json({ error: { code: status === 404 ? "RESOURCE_NOT_FOUND" : "DEBATE_FAILED", message, retryable: status >= 500 } }, { status });
  }
}
