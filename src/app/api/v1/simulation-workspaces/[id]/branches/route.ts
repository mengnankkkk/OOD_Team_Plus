import { NextRequest, NextResponse } from "next/server";

import { executeOption } from "@/server/extensions/simulation/service";
import { getRequestContext, idempotencyKey, meta } from "@/server/http/context";
import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idempotencyKey(req)) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } }, { status: 400 });
  const body = await req.json().catch(() => null) as { parentBranchId?: string; optionId?: string; name?: string } | null;
  if (!body?.parentBranchId || !body.optionId || !body.name) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "parentBranchId, optionId and name required" } }, { status: 400 });
  const { userId } = getRequestContext(req); const key = idempotencyKey(req)!; const routeCode = `simulation_branch:${id}`; const idem = await beginIdempotentRequest(userId, routeCode, key, body);
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  try {
    const result = executeOption(userId, id, { parentBranchId: body.parentBranchId, optionId: body.optionId, name: body.name });
    const payload = { data: { ...result, ordersCreated: false, analysis: { analysisId: result.analysisId, type: "BRANCH_EXECUTION", status: "COMPLETED", streamUrl: `/api/v1/analyses/${result.analysisId}/events` } }, meta: meta() };
    await saveIdempotentResponse(userId, routeCode, key, idem.requestHash, payload);
    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Branch execution failed";
    const status = message === "OPTION_ALREADY_EXECUTED" || message === "WORKSPACE_ARCHIVED" ? 409 : message === "OPTION_BRANCH_MISMATCH" ? 422 : 404;
    return NextResponse.json({ error: { code: status === 404 ? "RESOURCE_NOT_FOUND" : message, message } }, { status });
  }
}
