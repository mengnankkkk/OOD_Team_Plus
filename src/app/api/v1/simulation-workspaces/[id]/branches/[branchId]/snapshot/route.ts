import { NextRequest, NextResponse } from "next/server";

import { getBranchSnapshot } from "@/server/extensions/simulation/service";
import { getRequestContext, meta } from "@/server/http/context";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; branchId: string }> }) {
  const { id, branchId } = await params;
  const data = getBranchSnapshot(getRequestContext(req).userId, id, branchId);
  if (!data) return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Branch snapshot not found" } }, { status: 404 });
  return NextResponse.json({ data, meta: meta() });
}
