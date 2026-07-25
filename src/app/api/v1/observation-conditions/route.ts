import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  createCondition,
  CreateConditionSchema,
  listConditions,
} from "@/server/extensions/notifications/condition-service";
import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";
import { domainResponse } from "@/server/extensions/watchlists/http";
import { getRequestContext, idempotencyKey, meta } from "@/server/http/context";

const StatusSchema = z.enum(["active", "paused", "deleted"]);

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status");
  const parsedStatus = status ? StatusSchema.safeParse(status) : null;
  if (parsedStatus && !parsedStatus.success) {
    return NextResponse.json(
      { error: { code: "OBSERVATION_CONDITION_INVALID", message: "Invalid condition status" } },
      { status: 422 },
    );
  }
  const rawLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;
  const items = listConditions(getRequestContext(request).userId, {
    watchlistItemId: request.nextUrl.searchParams.get("watchlistItemId") ?? undefined,
    status: parsedStatus?.success ? parsedStatus.data : undefined,
    limit,
  });
  return NextResponse.json({ data: { items }, meta: meta({ pagination: { limit, nextCursor: null, hasMore: false } }) });
}

export async function POST(request: NextRequest) {
  const key = idempotencyKey(request);
  if (!key) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } },
      { status: 400 },
    );
  }
  const parsed = CreateConditionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "OBSERVATION_CONDITION_INVALID", message: "Invalid observation condition", details: parsed.error.format() } },
      { status: 422 },
    );
  }
  const { userId } = getRequestContext(request);
  const routeCode = `observation_condition:${parsed.data.watchlistItemId}`;
  const idem = await beginIdempotentRequest(userId, routeCode, key, parsed.data);
  if (idem.existing?.conflict) {
    return NextResponse.json(
      { error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } },
      { status: 409 },
    );
  }
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  try {
    const payload = { data: createCondition(userId, parsed.data), meta: meta() };
    await saveIdempotentResponse(userId, routeCode, key, idem.requestHash, payload);
    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    return domainResponse(error);
  }
}
