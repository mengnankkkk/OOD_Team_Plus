import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const RouteContext = z.object({
  params: z.object({ id: z.string().min(1) }),
});

const UpdateWatchlistSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  status: z.enum(["active", "archived"]).optional(),
});

function invalidRequest(message: string, details?: Record<string, unknown>) {
  return NextResponse.json(
    { error: { code: "INVALID_REQUEST", message, ...(details ? { details } : {}) } },
    { status: 400 },
  );
}

function notFound() {
  return NextResponse.json(
    { error: { code: "RESOURCE_NOT_FOUND", message: "Watchlist not found" } },
    { status: 404 },
  );
}

function validateContext(params: unknown) {
  const parsed = RouteContext.safeParse({ params });
  return parsed.success ? parsed.data.params : null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;

  if (!validateContext(resolvedParams)) {
    return invalidRequest("Invalid route params");
  }

  return notFound();
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;

  if (!validateContext(resolvedParams)) {
    return invalidRequest("Invalid route params");
  }

  if (!req.headers.get("If-Match")) {
    return invalidRequest("If-Match required");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return invalidRequest("Invalid JSON");
  }

  const parsed = UpdateWatchlistSchema.safeParse(body);
  if (!parsed.success) {
    return invalidRequest("Invalid request", parsed.error.format() as Record<string, unknown>);
  }

  return notFound();
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;

  if (!validateContext(resolvedParams)) {
    return invalidRequest("Invalid route params");
  }

  if (!_req.headers.get("If-Match")) {
    return invalidRequest("If-Match required");
  }

  return notFound();
}
