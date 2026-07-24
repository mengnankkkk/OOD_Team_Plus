import { NextResponse } from "next/server";

import { getSystemHealth } from "@/server/health/system-health";
import { meta } from "@/server/http/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const health = getSystemHealth();
  return NextResponse.json({ data: health, meta: meta() }, { status: health.status === "NOT_READY" ? 503 : 200 });
}
