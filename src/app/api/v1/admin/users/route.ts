import { NextRequest, NextResponse } from "next/server";

import { authError, requireAdmin } from "@/server/auth/http";
import { listUsers } from "@/server/auth/admin-service";
import { getRequestContext, meta } from "@/server/http/context";

export async function GET(request: NextRequest) {
  try {
    requireAdmin(getRequestContext(request).user);
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 20), 1), 100);
    const offset = Math.max(Number(request.nextUrl.searchParams.get("offset") ?? 0), 0);
    const result = listUsers({ query: request.nextUrl.searchParams.get("q") ?? undefined, limit, offset });
    return NextResponse.json({ data: result, meta: meta({ pagination: { limit, offset, total: result.total } }) });
  } catch (error) {
    return authError(error);
  }
}
