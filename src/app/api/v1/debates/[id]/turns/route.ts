import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { continueDebate } from "@/server/extensions/debate/service";
import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";
import { getRequestContext, idempotencyKey, meta } from "@/server/http/context";

const DebateTurnSchema = z.object({
  content: z.string().min(1).max(4000),
  userRole: z.enum(["neutral", "bull", "bear"]).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = DebateTurnSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid debate turn", details: parsed.error.format() } }, { status: 422 });
  const key = idempotencyKey(req);
  if (!key) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } }, { status: 400 });
  const { userId } = getRequestContext(req);
  const routeCode = `debate_turn:${id}`;
  const idem = await beginIdempotentRequest(userId, routeCode, key, parsed.data);
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  try {
    const result = await continueDebate({ userId, debateSessionId: id, ...parsed.data });
    const payload = { data: result, meta: meta() };
    await saveIdempotentResponse(userId, routeCode, key, idem.requestHash, payload);
    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Debate turn failed";
    const status = message === "Debate not found" ? 404 : 502;
    return NextResponse.json({ error: { code: status === 404 ? "RESOURCE_NOT_FOUND" : "DEBATE_TURN_FAILED", message, retryable: status >= 500 } }, { status });
  }
}
