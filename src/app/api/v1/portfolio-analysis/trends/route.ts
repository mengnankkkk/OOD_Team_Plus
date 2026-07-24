import { NextRequest, NextResponse } from "next/server";

import { getPortfolioTrends } from "@/server/extensions/analysis/service";
import { getRequestContext, meta } from "@/server/http/context";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const snapshotId = req.nextUrl.searchParams.get("portfolioSnapshotId") ?? req.nextUrl.searchParams.get("snapshotId") ?? undefined;
  const data = getPortfolioTrends(getRequestContext(req).userId, snapshotId);
  if (!data) return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Portfolio snapshot not found" } }, { status: 404 });
  return NextResponse.json({ data, meta: meta({ source: data.source, modelVersion: data.modelVersion }) });
}
