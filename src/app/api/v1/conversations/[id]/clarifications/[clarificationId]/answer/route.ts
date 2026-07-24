import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { runConversationAgent } from "@/server/extensions/advisor/service";
import { completeClarification } from "@/server/extensions/advisor/clarification-service";
import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";
import { getRequestContext, idempotencyKey, meta } from "@/server/http/context";

const Schema = z.object({ answers: z.record(z.string(), z.unknown()) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; clarificationId: string }> }) {
  const { id, clarificationId } = await params;
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "answers are required", details: parsed.error.format() } }, { status: 422 });
  const key = idempotencyKey(req);
  if (!key) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } }, { status: 400 });
  const userId = getRequestContext(req).userId;
  const routeCode = `clarification_answer:${clarificationId}`;
  const idem = await beginIdempotentRequest(userId, routeCode, key, parsed.data);
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  try {
    const clarification = completeClarification({ userId, sessionId: id, clarificationId, answers: parsed.data.answers });
    const result = await runConversationAgent({ userId, sessionId: id, content: clarification.originalContent, clientMessageId: `clarification:${clarificationId}` });
    const payload = { data: { clarificationId, status: "ANSWERED", analysis: (result as { analysis?: unknown }).analysis, result }, meta: meta() };
    await saveIdempotentResponse(userId, routeCode, key, idem.requestHash, payload);
    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Clarification failed";
    const status = message === "Clarification not found" || message === "Original message not found" ? 404 : message === "CLARIFICATION_ALREADY_ANSWERED" ? 409 : 422;
    return NextResponse.json({ error: { code: status === 404 ? "RESOURCE_NOT_FOUND" : status === 409 ? message : message, message, retryable: false } }, { status });
  }
}
