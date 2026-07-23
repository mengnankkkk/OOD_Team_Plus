import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function requestId(): string {
  return `req_${Date.now()}`;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const idempotencyKey = req.headers.get("Idempotency-Key");
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } },
      { status: 400 },
    );
  }

  const { id } = await params;
  const analysisId = `analysis_rss_sync_${id}_${Date.now()}`;

  return NextResponse.json(
    {
      data: {
        analysis: {
          analysisId,
          type: "RSS_SYNC",
          status: "QUEUED",
          streamUrl: `/api/v1/analyses/${analysisId}/events`,
        },
      },
      meta: {
        requestId: requestId(),
        apiVersion: "v1",
        generatedAt: new Date().toISOString(),
      },
    },
    { status: 202 },
  );
}
