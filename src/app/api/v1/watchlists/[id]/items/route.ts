import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { domainResponse, invalid } from "@/server/extensions/watchlists/http";
import { createWatchlistItemInDb, listWatchlistItems } from "@/server/extensions/watchlists/service";
import {
  IdempotencyConflictError,
  runIdempotentMutation,
} from "@/server/extensions/middleware/idempotency";
import { getRequestContext, idempotencyKey, meta } from "@/server/http/context";

const CreateItemSchema = z.object({
  instrumentId: z.string().trim().min(1),
  reason: z.string().trim().max(500).optional(),
  plannedHorizon: z.string().trim().max(120).optional(),
  goalId: z.string().trim().min(1).nullable().optional(),
  source: z.enum(["USER", "AGENT", "IMPORT"]).default("USER"),
  initialDrawdownThresholdPct: z.number().min(1).max(90).nullable().optional(),
  drawdownThresholdPct: z.number().min(1).max(90).nullable().optional(),
}).transform(({ drawdownThresholdPct, ...input }) => ({
  ...input,
  initialDrawdownThresholdPct: input.initialDrawdownThresholdPct ?? drawdownThresholdPct,
}));

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  const key = idempotencyKey(request);
  if (!key) return invalid("Idempotency-Key required");
  const parsed = CreateItemSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid("Invalid request", parsed.error.format());
  const { id } = await params;
  const { userId } = getRequestContext(request);
  const routeCode = `watchlist_item_create:${id}`;
  try {
    const result = runIdempotentMutation(
      userId,
      routeCode,
      key,
      parsed.data,
      (db) => ({ data: createWatchlistItemInDb(db, userId, id, parsed.data), meta: meta() }),
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

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const raw = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 100) : 20;
  try {
    return NextResponse.json({
      data: listWatchlistItems(getRequestContext(request).userId, id, limit),
      meta: meta({ pagination: { limit, nextCursor: null, hasMore: false } }),
    });
  } catch (error) {
    return domainResponse(error);
  }
}
