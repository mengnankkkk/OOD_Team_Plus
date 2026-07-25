import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getNotificationSyncState, syncUserNotifications } from "@/server/extensions/notifications/proactive-service";
import { getRequestContext, meta } from "@/server/http/context";

const Schema = z.object({ forceMarketRefresh: z.boolean().optional() });

export async function GET(req: NextRequest) {
  return NextResponse.json({ data: getNotificationSyncState(getRequestContext(req).userId), meta: meta() });
}

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Invalid notification sync request", details: parsed.error.format() } }, { status: 400 });
  const result = await syncUserNotifications(getRequestContext(req).userId, {
    forceMarketRefresh: parsed.data.forceMarketRefresh,
    reason: parsed.data.forceMarketRefresh ? "manual-market-scan" : "page-open-scan",
  });
  return NextResponse.json({ data: result, meta: meta() }, { status: result.status === "failed" ? 502 : 200 });
}
