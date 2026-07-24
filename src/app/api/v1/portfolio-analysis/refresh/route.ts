import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { refreshPortfolio } from "@/server/extensions/analysis/service";
import { ExtensionErrorCode, type ExtensionError } from "@/server/extensions/errors/codes";
import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";
import { getRequestContext, idempotencyKey, meta } from "@/server/http/context";

const RefreshRequestSchema = z.object({ portfolioId: z.string().min(1), forceRefresh: z.boolean().optional(), conversationId: z.string().optional() });

export async function POST(req: NextRequest) {
  if (!idempotencyKey(req)) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key header required" } }, { status: 400 });
  const parsed = RefreshRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Invalid request body", details: parsed.error.format() } }, { status: 400 });
  const { userId } = getRequestContext(req);
  const key = idempotencyKey(req)!;
  const idem = await beginIdempotentRequest(userId, "portfolio_refresh", key, parsed.data);
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  try {
    const result = await refreshPortfolio(userId, parsed.data.portfolioId);
    const payload = { data: { portfolioSnapshotId: result.snapshotId, dataQuality: result.dataQuality, sourceStatuses: result.sourceStatuses, analysis: { analysisId: result.analysisId, type: "PORTFOLIO_REFRESH", status: "COMPLETED", streamUrl: `/api/v1/analyses/${result.analysisId}/events` } }, meta: meta() };
    await saveIdempotentResponse(userId, "portfolio_refresh", key, idem.requestHash, payload);
    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    const extensionError = error as Partial<ExtensionError>;
    const code = extensionError.code ?? ExtensionErrorCode.PANDA_DATA_UNAVAILABLE;
    const status = code === ExtensionErrorCode.RESOURCE_NOT_FOUND ? 404 : code === ExtensionErrorCode.VERSION_CONFLICT ? 409 : 502;
    return NextResponse.json({ error: { code, message: extensionError.message ?? "Portfolio refresh failed", retryable: extensionError.retryable ?? status >= 500, details: extensionError.details } }, { status });
  }
}
