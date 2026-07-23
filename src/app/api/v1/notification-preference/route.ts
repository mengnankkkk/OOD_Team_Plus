import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const PreferenceSchema = z.object({
  mode: z.enum(["IMPORTANT_ONLY", "DAILY_DIGEST", "MUTED"]),
  quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
});

function meta() {
  return {
    requestId: `req_${Date.now()}`,
    apiVersion: "v1" as const,
    generatedAt: new Date().toISOString(),
  };
}

function invalidRequest(message: string, details?: Record<string, unknown>) {
  return NextResponse.json(
    { error: { code: "INVALID_REQUEST", message, ...(details ? { details } : {}) } },
    { status: 400 },
  );
}

export async function GET() {
  return NextResponse.json({
    data: {
      mode: "IMPORTANT_ONLY",
      quietHoursStart: null,
      quietHoursEnd: null,
    },
    meta: meta(),
  });
}

export async function PUT(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return invalidRequest("Invalid JSON");
  }

  const parsed = PreferenceSchema.safeParse(body);
  if (!parsed.success) {
    return invalidRequest("Invalid preference", parsed.error.format() as Record<string, unknown>);
  }

  return NextResponse.json({
    data: {
      mode: parsed.data.mode,
      quietHoursStart: parsed.data.quietHoursStart ?? null,
      quietHoursEnd: parsed.data.quietHoursEnd ?? null,
    },
    meta: meta(),
  });
}
