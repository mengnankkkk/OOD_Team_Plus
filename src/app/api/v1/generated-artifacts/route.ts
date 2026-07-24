import { NextRequest, NextResponse } from "next/server";

import { GeneratedArtifactRequestSchema } from "@/server/extensions/schemas";
import { createArtifact, listArtifacts } from "@/server/extensions/artifacts/service";
import { ArtifactSourceError } from "@/server/extensions/artifacts/source";
import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";
import { getRequestContext, idempotencyKey, meta } from "@/server/http/context";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!idempotencyKey(req)) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } }, { status: 400 });
  const body = await req.json().catch(() => null);
  const parsed = GeneratedArtifactRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Invalid request", details: parsed.error.format() } }, { status: 400 });
  const { userId } = getRequestContext(req);
  const key = idempotencyKey(req)!;
  const idem = await beginIdempotentRequest(userId, "generated_artifact", key, parsed.data);
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  try {
    const result = createArtifact({ userId, artifactType: parsed.data.artifactType, title: parsed.data.title, sourceMessageId: parsed.data.sourceMessageId, sourceQueryId: parsed.data.sourceQueryId, sessionId: parsed.data.conversationId });
    const payload = { data: { resourceId: result.artifactId, analysis: { analysisId: result.analysisId, type: "ARTIFACT_GENERATION", status: "COMPLETED", streamUrl: `/api/v1/analyses/${result.analysisId}/events` } }, meta: meta() };
    await saveIdempotentResponse(userId, "generated_artifact", key, idem.requestHash, payload);
    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    if (error instanceof ArtifactSourceError) return NextResponse.json({ error: { code: error.code, message: error.message, retryable: false } }, { status: error.httpStatus });
    return NextResponse.json({ error: { code: "QUERY_RESULT_NOT_READY", message: error instanceof Error ? error.message : "Artifact source is not ready", retryable: true } }, { status: 409 });
  }
}

export async function GET(req: NextRequest) {
  const rawLimit = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 20;
  const items = listArtifacts(getRequestContext(req).userId, limit, { sourceMessageId: req.nextUrl.searchParams.get("messageId") ?? undefined, artifactType: req.nextUrl.searchParams.get("type") ?? undefined, status: req.nextUrl.searchParams.get("status") ?? undefined, sessionId: req.nextUrl.searchParams.get("conversationId") ?? undefined });
  return NextResponse.json({ data: { items }, meta: meta({ pagination: { limit, nextCursor: null, hasMore: false } }) });
}
