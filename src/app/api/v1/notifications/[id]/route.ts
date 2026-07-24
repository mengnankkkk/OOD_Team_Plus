import { NextRequest, NextResponse } from "next/server";

import { getDatabase, getRequestContext, isoNow, meta } from "@/server/http/context";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const expectedVersion = parseVersion(req);
  if (expectedVersion === null) return invalid("A numeric If-Match header is required");
  const body = await req.json().catch(() => null) as { action?: "MARK_READ" | "IGNORE" } | null;
  if (body?.action !== "MARK_READ" && body?.action !== "IGNORE") return invalid("action must be MARK_READ or IGNORE");
  const { userId } = getRequestContext(req);
  const db = getDatabase();
  const existing = db.prepare("SELECT * FROM notifications WHERE id=? AND user_id=?").get(id, userId) as Record<string, unknown> | undefined;
  if (!existing) { db.close(); return notFound(); }
  const field = body.action === "MARK_READ" ? "read_at" : "dismissed_at";
  const result = db.prepare(`UPDATE notifications SET ${field}=COALESCE(${field},?),updated_at=?,row_version=row_version+1 WHERE id=? AND user_id=? AND row_version=?`)
    .run(isoNow(), isoNow(), id, userId, expectedVersion);
  if (!result.changes) {
    db.close();
    return NextResponse.json({ error: { code: "VERSION_CONFLICT", message: "Notification version changed", details: { currentVersion: existing.row_version } } }, { status: 412 });
  }
  const row = db.prepare("SELECT * FROM notifications WHERE id=?").get(id) as Record<string, unknown>;
  db.close();
  return NextResponse.json({ data: formatNotification(row), meta: meta() });
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM notifications WHERE id=? AND user_id=?").get(id, getRequestContext(req).userId) as Record<string, unknown> | undefined;
  db.close();
  if (!row) return notFound();
  return NextResponse.json({ data: formatNotification(row), meta: meta() });
}

function formatNotification(row: Record<string, unknown>) {
  const status = row.dismissed_at ? "ignored" : row.read_at ? "read" : "unread";
  return { ...row, status, unread: status === "unread", version: row.row_version };
}

function parseVersion(req: NextRequest): number | null {
  const value = Number.parseInt(req.headers.get("If-Match")?.replaceAll('"', "") ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function invalid(message: string) { return NextResponse.json({ error: { code: "INVALID_REQUEST", message } }, { status: 400 }); }
function notFound() { return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Notification not found" } }, { status: 404 }); }
