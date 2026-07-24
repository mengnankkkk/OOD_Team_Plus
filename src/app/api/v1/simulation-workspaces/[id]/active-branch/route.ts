import { NextRequest, NextResponse } from "next/server";

import { switchBranch } from "@/server/extensions/simulation/service";
import { getRequestContext, meta } from "@/server/http/context";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!req.headers.get("If-Match")) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "If-Match required" } }, { status: 400 });
  const body = await req.json().catch(() => null) as { branchId?: string } | null;
  if (!body?.branchId) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "branchId required" } }, { status: 400 });
  const result = switchBranch(getRequestContext(req).userId, id, body.branchId);
  if (!result) return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Workspace or branch not found" } }, { status: 404 });
  return NextResponse.json({ data: result, meta: meta() });
}
