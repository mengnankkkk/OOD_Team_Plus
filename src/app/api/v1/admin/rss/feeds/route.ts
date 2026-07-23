import { NextRequest, NextResponse } from "next/server";

import { isSSRFBlocked } from "@/server/extensions/search/web-adapter";

export const runtime = "nodejs";

function requestId(): string {
  return `req_${Date.now()}`;
}

export async function POST(req: NextRequest) {
  // TODO: enforce admin access.
  const body = (await req.json().catch(() => ({}))) as { url?: string };

  if (!body.url) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "url required" } },
      { status: 400 },
    );
  }

  if (isSSRFBlocked(body.url)) {
    return NextResponse.json(
      { error: { code: "SSRF_BLOCKED", message: "URL blocked" } },
      { status: 400 },
    );
  }

  return NextResponse.json(
    {
      data: {
        id: `feed_${Date.now()}`,
        url: body.url,
        status: "active",
      },
      meta: {
        requestId: requestId(),
        apiVersion: "v1",
        generatedAt: new Date().toISOString(),
      },
    },
    { status: 201 },
  );
}

export async function GET() {
  return NextResponse.json({
    data: { items: [], feeds: [] },
    meta: {
      requestId: requestId(),
      apiVersion: "v1",
      generatedAt: new Date().toISOString(),
    },
  });
}
