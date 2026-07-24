import { NextRequest, NextResponse } from "next/server";

import { authError, requireAdmin } from "@/server/auth/http";
import { getSystemHealth } from "@/server/health/system-health";
import { getRequestContext, meta } from "@/server/http/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    requireAdmin(getRequestContext(request).user);
    const health = getSystemHealth();
    return NextResponse.json({ data: health, meta: meta() }, { status: health.status === "NOT_READY" ? 503 : 200 });
  } catch (error) {
    return authError(error);
  }
}
