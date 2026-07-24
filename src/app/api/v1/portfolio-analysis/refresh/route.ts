import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { IdempotencyKeySchema } from "@/server/extensions/schemas";

export const runtime = "nodejs";

const RefreshRequestSchema = z.object({
  portfolioId: z.string().min(1),
  forceRefresh: z.boolean().optional().default(false),
  conversationId: z.string().optional(),
});

function invalidRequest(message: string, details?: Record<string, unknown>) {
  return NextResponse.json(
    {
      error: {
        code: "INVALID_REQUEST",
        message,
        ...(details ? { details } : {}),
        retryable: false,
      },
    },
    { status: 400 },
  );
}

export async function POST(req: NextRequest) {
  const idempotencyKey = req.headers.get("Idempotency-Key");
  if (!idempotencyKey) {
    return invalidRequest("Idempotency-Key header required");
  }

  if (!IdempotencyKeySchema.safeParse(idempotencyKey).success) {
    return invalidRequest("Invalid Idempotency-Key header");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return invalidRequest("Invalid JSON body");
  }

  const parsed = RefreshRequestSchema.safeParse(body);
  if (!parsed.success) {
    return invalidRequest("Invalid request body", parsed.error.format() as Record<string, unknown>);
  }

  const analysisId = `analysis_refresh_${Date.now()}`;

  // TODO: persist the portfolio refresh request and enqueue snapshot creation.
  return NextResponse.json(
    {
      data: {
        analysis: {
          analysisId,
          type: "PORTFOLIO_REFRESH",
          status: "QUEUED",
          streamUrl: `/api/v1/analyses/${analysisId}/events`,
        },
      },
      meta: {
        requestId: `req_${Date.now()}`,
        apiVersion: "v1",
        generatedAt: new Date().toISOString(),
      },
    },
    { status: 202 },
  );
}
