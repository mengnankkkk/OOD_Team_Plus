import { NextRequest, NextResponse } from "next/server";

import { authError } from "@/server/auth/http";
import { getPortfolioHoldings } from "@/server/extensions/analysis/service";
import { getRequestContext, meta } from "@/server/http/context";

export async function GET(req: NextRequest) {
  try {
    const data = getPortfolioHoldings(getRequestContext(req).userId, req.nextUrl.searchParams.get("portfolioSnapshotId") ?? undefined);
    if (!data) return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Portfolio snapshot not found" } }, { status: 404 });
    return NextResponse.json({ data, meta: meta() });
  } catch (error) {
    return authError(error);
  }
}
