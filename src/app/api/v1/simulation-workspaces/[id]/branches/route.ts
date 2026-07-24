import { NextRequest, NextResponse } from "next/server";

import { executeOption } from "@/server/extensions/simulation/service";
import { getRequestContext, idempotencyKey, meta } from "@/server/http/context";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idempotencyKey(req)) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } }, { status: 400 });
  const body = await req.json().catch(() => null) as { parentBranchId?: string; optionId?: string; name?: string } | null;
  if (!body?.parentBranchId || !body.optionId || !body.name) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "parentBranchId, optionId and name required" } }, { status: 400 });
  try {
    const result = executeOption(getRequestContext(req).userId, id, { parentBranchId: body.parentBranchId, optionId: body.optionId, name: body.name });
    return NextResponse.json({ data: { ...result, ordersCreated: false, analysis: { analysisId: result.analysisId, type: "BRANCH_EXECUTION", status: "COMPLETED", streamUrl: `/api/v1/analyses/${result.analysisId}/events` } }, meta: meta() }, { status: 201 });
  } catch (error) { const message = error instanceof Error ? error.message : "Branch execution failed"; return NextResponse.json({ error: { code: message === "OPTION_ALREADY_EXECUTED" ? message : "RESOURCE_NOT_FOUND", message } }, { status: message === "OPTION_ALREADY_EXECUTED" ? 409 : 404 }); }
}
