import { NextRequest, NextResponse } from "next/server";

import { getDatabase, getRequestContext, meta } from "@/server/http/context";

export async function GET(req: NextRequest) {
  const unreadOnly = req.nextUrl.searchParams.get("unreadOnly") === "true";
  const rawSeverity = req.nextUrl.searchParams.get("severity");
  const allowedSeverities = new Set(["INFORMATION", "ATTENTION", "IMPORTANT", "URGENT"]);
  const severity = rawSeverity?.toUpperCase() ?? null;
  if (severity && !allowedSeverities.has(severity)) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Invalid notification severity" } }, { status: 400 });
  const conditions = ["n.user_id = ?", "n.dismissed_at IS NULL"];
  const params: unknown[] = [getRequestContext(req).userId];
  if (unreadOnly) conditions.push("n.read_at IS NULL");
  if (severity) { conditions.push("UPPER(n.severity) = ?"); params.push(severity); }
  const raw = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 100) : 20;
  params.push(limit);
  const db = getDatabase();
  const rows = db.prepare(`SELECT n.*, c.condition_type, c.threshold_decimal
    FROM notifications n LEFT JOIN observation_conditions c ON c.id = n.condition_id
    WHERE ${conditions.join(" AND ")} ORDER BY n.created_at DESC LIMIT ?`).all(...params) as Array<Record<string, unknown>>;
  const unread = (db.prepare("SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND dismissed_at IS NULL AND read_at IS NULL").get(getRequestContext(req).userId) as { count: number }).count;
  db.close();
  return NextResponse.json({
    data: { items: rows.map((row) => ({ ...row, conditionId: row.condition_id, eventId: row.event_id, groupKey: row.group_key, occurrenceCount: 1, actions: ["VIEW_ANALYSIS", "OPEN_SIMULATION", "IGNORE"], version: row.row_version ?? 1 })), unreadCount: unread, filters: { unreadOnly, severity } },
    meta: meta({ pagination: { limit, nextCursor: rows.length === limit ? String(limit) : null, hasMore: rows.length === limit } }),
  });
}
