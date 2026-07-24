import { NextRequest, NextResponse } from "next/server";

import { GeneratedArtifactRequestSchema } from "@/server/extensions/schemas";

export const runtime = "nodejs";

function requestId(): string {
  return `req_${Date.now()}`;
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

  const parsed = GeneratedArtifactRequestSchema.safeParse(body);
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

  const artifactId = `art_${Date.now()}`;
  const analysisId = `analysis_art_${artifactId}`;
  return NextResponse.json(
    {
      data: {
        resourceId: artifactId,
        analysis: {
          analysisId,
          type: "ARTIFACT_GENERATION",
          status: "QUEUED",
          streamUrl: `/api/v1/analyses/${analysisId}/events`,
        },
      },
      meta: { requestId: requestId(), apiVersion: "v1", generatedAt: new Date().toISOString() },
    },
    { status: 202 },
  );
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);

  return NextResponse.json({
    data: { items: [] },
    meta: {
      requestId: requestId(),
      apiVersion: "v1",
      generatedAt: new Date().toISOString(),
      pagination: { limit, nextCursor: null, hasMore: false },
    },
  });
}
