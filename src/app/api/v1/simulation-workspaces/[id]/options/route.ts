import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { generateOptions, listOptions } from "@/server/extensions/simulation/service";
import { createId, getRequestContext, idempotencyKey, meta } from "@/server/http/context";

const OptionsRequestSchema = z.object({ objective: z.string().min(1).max(2000), conversationId: z.string().optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idempotencyKey(req)) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } }, { status: 400 });
  const parsed = OptionsRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Invalid request", details: parsed.error.format() } }, { status: 400 });
  try {
    const result = await generateOptions(getRequestContext(req).userId, id, parsed.data.objective);
    return NextResponse.json({ data: { batchId: result.batchId, status: "COMPLETED", items: result.candidates, priceManifest: result.priceManifest, analysis: { analysisId: result.analysisId, type: "BRANCH_OPTION_GENERATION", status: "COMPLETED", streamUrl: `/api/v1/analyses/${result.analysisId}/events` } }, meta: meta() }, { status: 202 });
  } catch (error) { return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: error instanceof Error ? error.message : "Workspace not found" } }, { status: 404 }); }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = listOptions(getRequestContext(req).userId, id, req.nextUrl.searchParams.get("batchId") ?? undefined);
  if (!result) return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Workspace not found" } }, { status: 404 });
  return NextResponse.json({ data: { batchId: result.batch?.id ?? null, status: result.batch ? String(result.batch.status).toUpperCase() : "EMPTY", items: result.items }, meta: meta() });
}
