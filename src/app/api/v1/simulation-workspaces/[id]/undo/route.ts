import { NextRequest, NextResponse } from "next/server";

import { undoBranch } from "@/server/extensions/simulation/service";
import { getRequestContext, idempotencyKey, meta } from "@/server/http/context";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idempotencyKey(req) || !req.headers.get("If-Match")) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key and If-Match required" } }, { status: 400 });
  try {
    const result = undoBranch(getRequestContext(req).userId, id);
    if (!result) return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Workspace not found" } }, { status: 404 });
    return NextResponse.json({ data: result, meta: meta() });
  } catch (error) { return NextResponse.json({ error: { code: "ROOT_BRANCH_CANNOT_UNDO", message: error instanceof Error ? error.message : "Cannot undo root branch" } }, { status: 409 }); }
}
