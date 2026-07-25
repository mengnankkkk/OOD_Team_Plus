import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { domainResponse, invalid } from "@/server/extensions/watchlists/http";
import { createWatchlistItem, listWatchlistItems } from "@/server/extensions/watchlists/service";
import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";
import { getRequestContext, idempotencyKey, meta } from "@/server/http/context";

const CreateItemSchema = z.object({
  instrumentId: z.string().trim().min(1),
  reason: z.string().trim().max(500).optional(),
  plannedHorizon: z.string().trim().max(120).optional(),
  goalId: z.string().trim().min(1).nullable().optional(),
  source: z.enum(["USER", "AGENT", "IMPORT"]).default("USER"),
  initialDrawdownThresholdPct: z.number().min(1).max(90).nullable().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  const key = idempotencyKey(request);
  if (!key) return invalid("Idempotency-Key required");
  const parsed = CreateItemSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid("Invalid request", parsed.error.format());
  const { id } = await params;
  const { userId } = getRequestContext(request);
  const routeCode = `watchlist_item_create:${id}`;
  const idem = await beginIdempotentRequest(userId, routeCode, key, parsed.data);
  if (idem.existing?.conflict) {
    return NextResponse.json(
      { error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } },
      { status: 409 },
    );
  }
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  try {
    const payload = { data: createWatchlistItem(userId, id, parsed.data), meta: meta() };
    await saveIdempotentResponse(userId, routeCode, key, idem.requestHash, payload);
    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
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
