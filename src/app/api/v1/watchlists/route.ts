import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const CreateWatchlistSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
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

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return invalidRequest("Invalid JSON");
  }

  const parsed = CreateWatchlistSchema.safeParse(body);
  if (!parsed.success) {
    return invalidRequest("Invalid request", parsed.error.format() as Record<string, unknown>);
  }

  const watchlistId = `wl_${Date.now()}`;

  return NextResponse.json(
    {
      data: {
        id: watchlistId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        status: "active",
        createdAt: new Date().toISOString(),
      },
      meta: meta(),
    },
    { status: 201 },
  );
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const parsedLimit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 20;

  return NextResponse.json({
    data: { items: [] },
    meta: {
      ...meta(),
      pagination: { limit, nextCursor: null, hasMore: false },
    },
  });
}
