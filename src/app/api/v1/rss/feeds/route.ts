import { NextRequest, NextResponse } from "next/server";

import { formatFeed } from "@/app/api/v1/admin/rss/feeds/route";
import { getDatabase, meta } from "@/server/http/context";

export async function GET(req: NextRequest) {
  const limit = Math.min(Math.max(Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10) || 20, 1), 100);
  const offset = Math.max(0, Number.parseInt(req.nextUrl.searchParams.get("cursor") ?? "0", 10) || 0);
  const enabled = req.nextUrl.searchParams.get("enabled");
  if (enabled !== null && enabled !== "true" && enabled !== "false") return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "enabled must be true or false" } }, { status: 422 });
  const conditions = ["status!='deleted'"];
  if (enabled === "true") conditions.push("status='active'");
  if (enabled === "false") conditions.push("status!='active'");
  const db = getDatabase();
  const rows = db.prepare(`SELECT * FROM rss_feeds WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(limit + 1, offset) as Array<Record<string, unknown>>;
  db.close();
  const hasMore = rows.length > limit;
  return NextResponse.json({ data: { items: rows.slice(0, limit).map(formatFeed) }, meta: meta({ pagination: { limit, nextCursor: hasMore ? String(offset + limit) : null, hasMore } }) });
}
