import { NextRequest, NextResponse } from "next/server";

import { getRequestContext, meta } from "@/server/http/context";
import { getQueryResult } from "@/server/extensions/query/service";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rawLimit = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? req.nextUrl.searchParams.get("pageSize") ?? "100", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 100;
  const offset = Math.max(0, Number.parseInt(req.nextUrl.searchParams.get("offset") ?? "0", 10) || 0);
  const result = getQueryResult(getRequestContext(req).userId, id, limit, offset);
  if (!result) return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Data query not found" } }, { status: 404 });
  if ("notReady" in result) return NextResponse.json({ error: { code: "QUERY_RESULT_NOT_READY", message: "Query result is not ready", retryable: true } }, { status: 409 });
  return NextResponse.json({ data: result, meta: meta({ pagination: { limit, nextCursor: result.items.length === limit ? String(offset + limit) : null, hasMore: result.items.length === limit } }) });
}
