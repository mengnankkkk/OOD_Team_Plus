import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function requestId(): string {
  return `req_${Date.now()}`;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const keyword = url.searchParams.get("keyword");
  void keyword;

  return NextResponse.json({
    data: { items: [], feeds: [] },
    meta: {
      requestId: requestId(),
      apiVersion: "v1",
      generatedAt: new Date().toISOString(),
      pagination: { limit: 20, nextCursor: null, hasMore: false },
    },
  });
}
