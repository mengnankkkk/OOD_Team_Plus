import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { generateOptions, listOptions } from "@/server/extensions/simulation/service";
import { getRequestContext, idempotencyKey, meta } from "@/server/http/context";
import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";

const OptionsRequestSchema = z.object({ objective: z.string().min(1).max(2000), conversationId: z.string().optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idempotencyKey(req)) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } }, { status: 400 });
  const parsed = OptionsRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Invalid request", details: parsed.error.format() } }, { status: 400 });
  const { userId } = getRequestContext(req); const key = idempotencyKey(req)!; const routeCode = `simulation_options:${id}`; const idem = await beginIdempotentRequest(userId, routeCode, key, parsed.data);
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  try {
    const result = generateOptions(userId, id, parsed.data.objective);
    const payload = { data: { batchId: result.batchId, status: "QUEUED", items: [], priceManifest: null, analysis: { analysisId: result.analysisId, type: "BRANCH_OPTION_GENERATION", status: "QUEUED", streamUrl: `/api/v1/analyses/${result.analysisId}/events` } }, meta: meta() };
    await saveIdempotentResponse(userId, routeCode, key, idem.requestHash, payload);
    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workspace not found";
    const status = message === "WORKSPACE_ARCHIVED" || message === "OPTIONS_ALREADY_RUNNING" ? 409 : 404;
    return NextResponse.json({ error: { code: status === 409 ? message : "RESOURCE_NOT_FOUND", message } }, { status });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = listOptions(getRequestContext(req).userId, id, req.nextUrl.searchParams.get("batchId") ?? undefined);
  if (!result) return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Workspace not found" } }, { status: 404 });
  return NextResponse.json({ data: { batchId: result.batch?.id ?? null, status: result.batch ? String(result.batch.status).toUpperCase() : "EMPTY", items: result.items, provider: result.provider, fallbackReason: result.fallbackReason ?? null, analysis: result.analysisId ? { analysisId: result.analysisId, type: "BRANCH_OPTION_GENERATION", status: result.batch ? String(result.batch.status).toUpperCase() : "EMPTY", streamUrl: `/api/v1/analyses/${result.analysisId}/events` } : null, priceManifest: result.batch?.price_manifest_json ? JSON.parse(String(result.batch.price_manifest_json)) : null }, meta: meta() });
}
