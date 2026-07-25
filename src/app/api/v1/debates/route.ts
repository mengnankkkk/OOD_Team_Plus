import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { startDebateInBackground, type DebateBackgroundScheduler } from "@/server/extensions/debate/service";
import { beginIdempotentRequest, parseIdempotentResponse, releaseIdempotentRequest, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";
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
  const idem = await beginIdempotentRequest(userId, "debate_create", key, parsed.data, { reserve: true });
  if (idem.existing?.active) return NextResponse.json({ error: { code: "RUN_ALREADY_ACTIVE", message: "An identical request is already running" } }, { status: 409 });
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  let started = false;
  try {
    const result = startDebateInBackground({ userId, ...parsed.data }, scheduleAfterResponse);
    started = true;
    const payload = { data: result, meta: meta() };
    await saveIdempotentResponse(userId, "debate_create", key, idem.requestHash, payload);
    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    if (!started) await releaseIdempotentRequest(userId, "debate_create", key, idem.requestHash);
    const message = error instanceof Error ? error.message : "Debate failed";
    const status = message === "Conversation not found" ? 404 : 502;
    return NextResponse.json({ error: { code: status === 404 ? "RESOURCE_NOT_FOUND" : "DEBATE_FAILED", message, retryable: status >= 500 } }, { status });
  }
}

const scheduleAfterResponse: DebateBackgroundScheduler = (task) => {
  after(() => task().catch(() => undefined));
};
