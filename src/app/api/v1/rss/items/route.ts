import { NextRequest, NextResponse } from "next/server";

import { getDatabase, meta, parseJson } from "@/server/http/context";

export async function GET(req: NextRequest) {
  const limit = Math.min(Math.max(Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10) || 50, 1), 100);
  const offset = Math.max(0, Number.parseInt(req.nextUrl.searchParams.get("cursor") ?? "0", 10) || 0);
  const feedId = req.nextUrl.searchParams.get("feedId");
  const query = req.nextUrl.searchParams.get("q")?.trim();
  const publishedAfter = req.nextUrl.searchParams.get("publishedAfter");
  if (query && query.length > 200) return invalid("q must be at most 200 characters");
  if (publishedAfter && !Number.isFinite(Date.parse(publishedAfter))) return invalid("publishedAfter must be an ISO date");
  const db = getDatabase();
  if (feedId && !db.prepare("SELECT id FROM rss_feeds WHERE id=? AND status!='deleted'").get(feedId)) { db.close(); return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "RSS feed not found" } }, { status: 404 }); }
  const conditions = ["f.status='active'"];
  const params: unknown[] = [];
  if (feedId) { conditions.push("i.feed_id=?"); params.push(feedId); }
  if (query) { conditions.push("(i.title LIKE ? OR i.summary LIKE ?)"); params.push(`%${query}%`, `%${query}%`); }
  if (publishedAfter) { conditions.push("i.published_at>=?"); params.push(new Date(publishedAfter).toISOString()); }
  params.push(limit + 1, offset);
  const rows = db.prepare(`SELECT i.*,f.title AS feed_title FROM rss_items i JOIN rss_feeds f ON f.id=i.feed_id WHERE ${conditions.join(" AND ")} ORDER BY i.published_at DESC,i.created_at DESC LIMIT ? OFFSET ?`).all(...params) as Array<Record<string, unknown>>;
  db.close();
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((row) => ({
    id: row.id,
    feedId: row.feed_id,
    feedName: row.feed_title,
    title: row.title,
    summary: row.summary,
    canonicalUrl: row.link,
    author: row.author,
    publishedAt: row.published_at,
    categories: parseJson(row.categories_json as string | null, []),
    source: "RSS",
  }));
  return NextResponse.json({ data: { items }, meta: meta({ pagination: { limit, nextCursor: hasMore ? String(offset + limit) : null, hasMore } }) });
}

function invalid(message: string) { return NextResponse.json({ error: { code: "VALIDATION_ERROR", message } }, { status: 422 }); }
