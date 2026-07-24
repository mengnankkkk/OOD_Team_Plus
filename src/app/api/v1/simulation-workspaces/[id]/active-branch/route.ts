import { NextRequest, NextResponse } from "next/server";

import { switchBranch } from "@/server/extensions/simulation/service";
import { getRequestContext, meta } from "@/server/http/context";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const expectedVersion = Number.parseInt(req.headers.get("If-Match")?.replaceAll('"', "") ?? "", 10);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "A numeric If-Match header is required" } }, { status: 400 });
  const body = await req.json().catch(() => null) as { branchId?: string } | null;
  if (!body?.branchId) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "branchId required" } }, { status: 400 });
  try {
    const result = switchBranch(getRequestContext(req).userId, id, body.branchId, expectedVersion);
    if (!result) return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Workspace or branch not found" } }, { status: 404 });
    return NextResponse.json({ data: result, meta: meta() });
  } catch {
    return NextResponse.json({ error: { code: "VERSION_CONFLICT", message: "Workspace version changed" } }, { status: 412 });
  }
}
