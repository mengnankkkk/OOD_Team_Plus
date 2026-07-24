import { NextRequest } from "next/server";

import { evaluateConditions } from "@/server/extensions/notifications/alert-engine";
import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";
import { getRequestContext, idempotencyKey, meta } from "@/server/http/context";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { conditionIds?: string[]; reason?: string } | null;
  const { userId } = getRequestContext(req);
  const key = idempotencyKey(req);
  if (!key) return Response.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } }, { status: 400 });
  const idem = await beginIdempotentRequest(userId, "observation_evaluate", key, body ?? {});
  if (idem.existing?.conflict) return Response.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return Response.json(parseIdempotentResponse(idem.existing), { status: 200 });
  const items = evaluateConditions(body?.conditionIds, body?.reason ?? `manual:${userId}`, userId);
  const payload = { data: { items }, meta: meta() };
  await saveIdempotentResponse(userId, "observation_evaluate", key, idem.requestHash, payload);
  return Response.json(payload);
}
