import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { syncRssFeed } from "@/server/extensions/rss/service";
import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";
import { DEMO_USER_ID, getRequestContext, idempotencyKey, meta } from "@/server/http/context";

const Schema = z.object({ force: z.boolean().default(false) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = getRequestContext(req);
  if (userId !== DEMO_USER_ID) return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Resource not found" } }, { status: 404 });
  if (!idempotencyKey(req)) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } }, { status: 400 });
  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid sync request", details: parsed.error.format() } }, { status: 422 });
  const key = idempotencyKey(req)!; const routeCode = `rss_sync:${id}`; const idem = await beginIdempotentRequest(userId, routeCode, key, { feedId: id, force: parsed.data.force });
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  try {
    const result = await syncRssFeed(id, userId, { force: parsed.data.force });
    const payload = { data: { ...result, analysis: { analysisId: result.analysisId, type: "RSS_SYNC", status: result.status, streamUrl: `/api/v1/analyses/${result.analysisId}/events` } }, meta: meta() };
    await saveIdempotentResponse(userId, routeCode, key, idem.requestHash, payload);
    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "RSS sync failed";
    const status = message === "Feed not found" ? 404 : message === "RSS sync already running" ? 409 : 502;
    return NextResponse.json({ error: { code: status === 404 ? "RESOURCE_NOT_FOUND" : status === 409 ? "RSS_SYNC_ALREADY_ACTIVE" : "RSS_UPSTREAM_FAILED", message, retryable: status >= 500 } }, { status });
  }
}
