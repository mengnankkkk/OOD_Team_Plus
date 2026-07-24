import { NextRequest, NextResponse } from "next/server";

import { getWorkspace } from "@/server/extensions/simulation/service";
import { getRequestContext, meta } from "@/server/http/context";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = getWorkspace(getRequestContext(req).userId, id);
  if (!data) return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Workspace not found" } }, { status: 404 });
  return NextResponse.json({ data: { workspaceId: id, activeBranchId: data.activeBranchId, branches: data.branches, events: data.events, version: data.version }, meta: meta() });
}
