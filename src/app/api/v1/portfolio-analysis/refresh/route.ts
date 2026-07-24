import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { refreshPortfolio } from "@/server/extensions/analysis/service";
import { getRequestContext, idempotencyKey, meta } from "@/server/http/context";

const RefreshRequestSchema = z.object({ portfolioId: z.string().min(1), forceRefresh: z.boolean().optional(), conversationId: z.string().optional() });

export async function POST(req: NextRequest) {
  if (!idempotencyKey(req)) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key header required" } }, { status: 400 });
  const parsed = RefreshRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Invalid request body", details: parsed.error.format() } }, { status: 400 });
  try {
    const result = refreshPortfolio(getRequestContext(req).userId, parsed.data.portfolioId);
    return NextResponse.json({ data: { portfolioSnapshotId: result.snapshotId, analysis: { analysisId: result.analysisId, type: "PORTFOLIO_REFRESH", status: "COMPLETED", streamUrl: `/api/v1/analyses/${result.analysisId}/events` } }, meta: meta() }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: error instanceof Error ? error.message : "Portfolio not found" } }, { status: 404 });
  }
}
