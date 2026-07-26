import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  IdempotencyConflictError,
} from "@/server/extensions/middleware/idempotency";
import { runIdempotentAsync } from "@/server/extensions/middleware/idempotency-async";
import { checkWatchlist } from "@/server/extensions/watchlists/check-service";
import { domainResponse, invalid } from "@/server/extensions/watchlists/http";
import { getRequestContext, idempotencyKey, meta } from "@/server/http/context";

const Schema = z.object({ forceMarketRefresh: z.boolean().default(true) });
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  const key = idempotencyKey(request);
  if (!key) return invalid("Idempotency-Key required");
  const parsed = Schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return invalid("Invalid check request", parsed.error.format());
  const { id } = await params;
  const { userId } = getRequestContext(request);
  try {
    const result = await runIdempotentAsync(
      userId,
      `watchlist_check:${id}`,
      key,
      parsed.data,
      async () => ({
        data: await checkWatchlist(userId, id, { ...parsed.data, reason: "watchlist-manual-check" }),
        meta: meta(),
      }),
    );
    return NextResponse.json(result.value, { status: 200 });
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: error.message } }, { status: 409 });
    }
    return domainResponse(error);
  }
}
