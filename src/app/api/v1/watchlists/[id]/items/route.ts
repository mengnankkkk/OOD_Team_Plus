import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

type RouteContext = { params: Promise<{ id: string }> };

const AddItemSchema = z.object({
  instrumentId: z.string().min(1),
  reason: z.string().max(500).optional(),
  plannedHorizon: z.string().optional(),
});

export async function POST(req: NextRequest, _context: RouteContext) {
  const body = await req.json().catch(() => ({}));
  const parsed = AddItemSchema.safeParse(body);
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

  // Persisting must reject an instrument already present in this active watchlist.
  return NextResponse.json(
    { error: { code: "RESOURCE_NOT_FOUND", message: "Watchlist not found" } },
    { status: 404 },
  );
}

export async function GET(_req: NextRequest, _context: RouteContext) {
  return NextResponse.json({
    data: { items: [] },
    meta: {
      requestId: `req_${Date.now()}`,
      apiVersion: "v1",
      generatedAt: new Date().toISOString(),
      pagination: { limit: 20, nextCursor: null, hasMore: false },
    },
  });
}
