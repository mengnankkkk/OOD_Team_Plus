import { NextRequest, NextResponse } from "next/server";

import { generateMockTrends } from "@/server/extensions/analysis/mock-trends";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const snapshotId = new URL(req.url).searchParams.get("snapshotId") ?? "default";
  const metrics = ["total_return", "drawdown", "volatility", "concentration"] as const;
  const trends = metrics.map((metric) => generateMockTrends(snapshotId, metric));

  return NextResponse.json({
    data: { trends },
    meta: {
      requestId: `req_${Date.now()}`,
      apiVersion: "v1",
      generatedAt: new Date().toISOString(),
      source: "MOCK",
      modelVersion: "mock-trend-v1",
      warning: "This data is deterministic mock data for demonstration purposes only. Do not use for financial decisions.",
    },
  });
}
