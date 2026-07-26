import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { domainResponse, invalid } from "@/server/extensions/watchlists/http";
import { createWatchlistInDb, listWatchlists } from "@/server/extensions/watchlists/service";
import {
  IdempotencyConflictError,
  runIdempotentMutation,
} from "@/server/extensions/middleware/idempotency";
import { getRequestContext, idempotencyKey, meta } from "@/server/http/context";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().optional(),
});
const StatusSchema = z.enum(["active", "archived"]).default("active");

export async function POST(request: NextRequest) {
  const key = idempotencyKey(request);
  if (!key) return invalid("Idempotency-Key required");
  const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid("Invalid request", parsed.error.format());
  const { userId } = getRequestContext(request);
  try {
    const result = runIdempotentMutation(
      userId,
      "watchlist_create",
      key,
      parsed.data,
      (db) => ({ data: createWatchlistInDb(db, userId, parsed.data), meta: meta() }),
    );
    return NextResponse.json(result.value, { status: 201 });
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

export async function GET(request: NextRequest) {
  const status = StatusSchema.safeParse(request.nextUrl.searchParams.get("status") ?? undefined);
  if (!status.success) return invalid("Invalid watchlist status", status.error.format());
  const raw = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 100) : 20;
  const items = listWatchlists(getRequestContext(request).userId, status.data, limit);
  return NextResponse.json({
    data: { items },
    meta: meta({ pagination: { limit, nextCursor: null, hasMore: false } }),
  });
}
