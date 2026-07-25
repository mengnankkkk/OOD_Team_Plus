import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { continueDebateInBackground, type DebateBackgroundScheduler } from "@/server/extensions/debate/service";
import { beginIdempotentRequest, parseIdempotentResponse, releaseIdempotentRequest, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";
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
  const idem = await beginIdempotentRequest(userId, routeCode, key, parsed.data, { reserve: true });
  if (idem.existing?.active) return NextResponse.json({ error: { code: "RUN_ALREADY_ACTIVE", message: "An identical request is already running" } }, { status: 409 });
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  let started = false;
  try {
    const result = continueDebateInBackground({ userId, debateSessionId: id, ...parsed.data }, scheduleAfterResponse);
    started = true;
    const payload = { data: result, meta: meta() };
    await saveIdempotentResponse(userId, routeCode, key, idem.requestHash, payload);
    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    if (!started) await releaseIdempotentRequest(userId, routeCode, key, idem.requestHash);
    const message = error instanceof Error ? error.message : "Debate turn failed";
    const code = isDebateSessionError(error)
      ? error.code
      : message === "RUN_ALREADY_ACTIVE"
        ? "RUN_ALREADY_ACTIVE"
        : "DEBATE_TURN_FAILED";
    const status = code === "DEBATE_NOT_FOUND"
      ? 404
      : code === "RUN_ALREADY_ACTIVE" || code === "DEBATE_BLOCKED" || code === "DEBATE_NOT_ACTIVE"
        ? 409
        : 502;
    return NextResponse.json({ error: { code, message, retryable: status >= 500 } }, { status });
  }
}

const scheduleAfterResponse: DebateBackgroundScheduler = (task) => {
  after(() => task().catch(() => undefined));
};

function isDebateSessionError(
  error: unknown,
): error is { code: "DEBATE_NOT_FOUND" | "DEBATE_BLOCKED" | "DEBATE_NOT_ACTIVE" } {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (
      error.code === "DEBATE_NOT_FOUND"
      || error.code === "DEBATE_BLOCKED"
      || error.code === "DEBATE_NOT_ACTIVE"
    );
}
