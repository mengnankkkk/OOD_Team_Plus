import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  createConditionInDb,
  CreateConditionSchema,
  listConditions,
} from "@/server/extensions/notifications/condition-service";
import {
  IdempotencyConflictError,
  runIdempotentMutation,
} from "@/server/extensions/middleware/idempotency";
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
  try {
    const result = runIdempotentMutation(
      userId,
      routeCode,
      key,
      parsed.data,
      (db) => ({ data: createConditionInDb(db, userId, parsed.data), meta: meta() }),
    );
    return NextResponse.json(result.value, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return NextResponse.json(
        { error: { code: "IDEMPOTENCY_CONFLICT", message: error.message } },
        { status: 409 },
      );
    }
    return domainResponse(error);
  }
}
