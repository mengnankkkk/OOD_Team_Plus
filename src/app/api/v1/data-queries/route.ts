import { NextRequest, NextResponse } from "next/server";

import { createExtensionError, ExtensionErrorCode } from "@/server/extensions/errors/codes";
import { DataQueryRequestSchema } from "@/server/extensions/schemas";

export const runtime = "nodejs";

type ErrorBody = {
  error: {
    code: ExtensionErrorCode | "INVALID_REQUEST";
    message: string;
    details?: Record<string, unknown>;
    retryable?: boolean;
  };
};

function requestId(): string {
  return `req_${Date.now()}`;
}

function errorResponse(
  code: ExtensionErrorCode | "INVALID_REQUEST",
  message: string,
  status: number,
  details?: Record<string, unknown>,
): NextResponse<ErrorBody> {
  const error = createExtensionError(code === "INVALID_REQUEST" ? ExtensionErrorCode.INVALID_REQUEST : code, message, details);

  return NextResponse.json({ error }, { status });
}

// userId must come from the signed session cookie in the real integration, never from the client body.
export async function POST(req: NextRequest) {
  const idempotencyKey = req.headers.get("Idempotency-Key");
  if (!idempotencyKey) {
    return errorResponse("INVALID_REQUEST", "Idempotency-Key header required", 400);
  }

  try {
    const body = await req.json();
    const parsed = DataQueryRequestSchema.safeParse(body);

    if (!parsed.success) {
      return errorResponse("INVALID_REQUEST", "Invalid request body", 400, parsed.error.format() as Record<string, unknown>);
    }

    const queryId = `query_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const analysisId = `analysis_${queryId}`;

    // TODO: persist the data query and enqueue the analysis run.
    return NextResponse.json(
      {
        data: {
          resourceId: queryId,
          analysis: {
            analysisId,
            type: "DATA_QUERY",
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
  } catch {
    return errorResponse("INVALID_REQUEST", "Failed to parse request body", 400);
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
  const cursor = url.searchParams.get("cursor");

  // TODO: query the database for the authenticated user's data queries using cursor pagination.
  void cursor;

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
