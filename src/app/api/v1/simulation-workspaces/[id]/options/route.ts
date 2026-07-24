import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const OptionsRequestSchema = z.object({
  objective: z.string().min(1).max(500),
  conversationId: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  void id;
  if (!req.headers.get("Idempotency-Key")) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } },
      { status: 400 },
    );
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = OptionsRequestSchema.safeParse(body);
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

  const analysisId = `analysis_opts_${Date.now()}`;
  return NextResponse.json(
    {
      data: {
        analysis: {
          analysisId,
          type: "BRANCH_OPTION_GENERATION",
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
