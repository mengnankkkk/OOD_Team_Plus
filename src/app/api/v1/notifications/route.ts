import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const SeveritySchema = z.enum(["low", "medium", "high", "critical"]);

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

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unreadOnly") === "true";
  const severityRaw = url.searchParams.get("severity");
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;

  if (severityRaw && !SeveritySchema.safeParse(severityRaw).success) {
    return invalidRequest("Invalid severity filter");
  }

  return NextResponse.json({
    data: { items: [], filters: { unreadOnly, severity: severityRaw ?? null } },
    meta: {
      ...meta(),
      pagination: { limit, nextCursor: null, hasMore: false },
    },
  });
}
