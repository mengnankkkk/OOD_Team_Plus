import { NextRequest, NextResponse } from "next/server";

import { undoBranch } from "@/server/extensions/simulation/service";
import { getRequestContext, idempotencyKey, meta } from "@/server/http/context";
import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const expectedVersion = Number.parseInt(req.headers.get("If-Match")?.replaceAll('"', "") ?? "", 10);
  if (!idempotencyKey(req) || !Number.isInteger(expectedVersion) || expectedVersion < 1) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key and numeric If-Match required" } }, { status: 400 });
  const { userId } = getRequestContext(req); const key = idempotencyKey(req)!; const routeCode = `simulation_undo:${id}`; const requestBody = { version: req.headers.get("If-Match") }; const idem = await beginIdempotentRequest(userId, routeCode, key, requestBody);
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  try {
    const result = undoBranch(userId, id, expectedVersion);
    if (!result) return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Workspace not found" } }, { status: 404 });
    const payload = { data: result, meta: meta() };
    await saveIdempotentResponse(userId, routeCode, key, idem.requestHash, payload);
    return NextResponse.json(payload);
  } catch (error) { const message = error instanceof Error ? error.message : "Cannot undo root branch"; return NextResponse.json({ error: { code: message === "VERSION_CONFLICT" ? message : "ROOT_BRANCH_CANNOT_UNDO", message } }, { status: message === "VERSION_CONFLICT" ? 412 : 409 }); }
}
