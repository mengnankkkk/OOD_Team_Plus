import { NextRequest, NextResponse } from "next/server";

import { SimulationWorkspaceRequestSchema } from "@/server/extensions/schemas";

export const runtime = "nodejs";

function meta() {
  return {
    requestId: `req_${Date.now()}`,
    apiVersion: "v1" as const,
    generatedAt: new Date().toISOString(),
  };
}

export async function POST(req: NextRequest) {
  if (!req.headers.get("Idempotency-Key")) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "Invalid JSON" } },
      { status: 400 },
    );
  }

  const parsed = SimulationWorkspaceRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid request",
          details: parsed.error.format(),
        },
      },
      { status: 400 },
    );
  }

  const workspaceId = `ws_${Date.now()}`;
  const analysisId = `analysis_${workspaceId}`;
  return NextResponse.json(
    {
      data: {
        resourceId: workspaceId,
        analysis: {
          analysisId,
          type: "PORTFOLIO_REFRESH",
          status: "QUEUED",
          streamUrl: `/api/v1/analyses/${analysisId}/events`,
        },
      },
      meta: meta(),
    },
    { status: 202 },
  );
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
  void status;

  return NextResponse.json({
    data: { items: [] },
    meta: {
      ...meta(),
      pagination: { limit, nextCursor: null, hasMore: false },
    },
  });
}
