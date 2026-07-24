import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getDatabase, getRequestContext, isoNow, meta } from "@/server/http/context";

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  status: z.enum(["ACTIVE", "ARCHIVED", "active", "archived"]).optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM watchlists WHERE id=? AND user_id=? AND status!='deleted'").get(id, getRequestContext(req).userId) as Record<string, unknown> | undefined;
  if (!row) { db.close(); return notFound(); }
  const count = db.prepare("SELECT COUNT(*) as count FROM watchlist_items WHERE watchlist_id=? AND status='active'").get(id) as { count: number };
  db.close();
  return NextResponse.json({ data: { ...row, itemCount: count.count }, meta: meta() });
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const expectedVersion = parseVersion(req);
  if (expectedVersion === null) return invalid("A numeric If-Match header is required");
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid("Invalid watchlist update", parsed.error.format());
  const { userId } = getRequestContext(req);
  const db = getDatabase();
  const exists = db.prepare("SELECT row_version FROM watchlists WHERE id=? AND user_id=? AND status!='deleted'").get(id, userId) as { row_version: number } | undefined;
  if (!exists) { db.close(); return notFound(); }
  const result = db.prepare(`UPDATE watchlists SET name=COALESCE(?,name),description=CASE WHEN ? THEN ? ELSE description END,
      status=COALESCE(?,status),updated_at=?,row_version=row_version+1
    WHERE id=? AND user_id=? AND status!='deleted' AND row_version=?`).run(
    parsed.data.name ?? null,
    Object.hasOwn(parsed.data, "description") ? 1 : 0,
    parsed.data.description ?? null,
    parsed.data.status?.toLowerCase() ?? null,
    isoNow(), id, userId, expectedVersion,
  );
  if (!result.changes) { db.close(); return versionConflict(exists.row_version); }
  const row = db.prepare("SELECT * FROM watchlists WHERE id=?").get(id);
  db.close();
  return NextResponse.json({ data: row, meta: meta() });
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const expectedVersion = parseVersion(req);
  if (expectedVersion === null) return invalid("A numeric If-Match header is required");
  const { userId } = getRequestContext(req);
  const db = getDatabase();
  const row = db.prepare("SELECT status,row_version FROM watchlists WHERE id=? AND user_id=?").get(id, userId) as { status: string; row_version: number } | undefined;
  if (!row || row.status === "deleted") { db.close(); return new Response(null, { status: 204 }); }
  const result = db.prepare("UPDATE watchlists SET status='deleted',deleted_at=?,updated_at=?,row_version=row_version+1 WHERE id=? AND user_id=? AND row_version=?").run(isoNow(), isoNow(), id, userId, expectedVersion);
  db.close();
  return result.changes ? new Response(null, { status: 204 }) : versionConflict(row.row_version);
}

function parseVersion(req: NextRequest): number | null {
  const value = Number.parseInt(req.headers.get("If-Match")?.replaceAll('"', "") ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function notFound() { return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Watchlist not found" } }, { status: 404 }); }
function invalid(message: string, details?: unknown) { return NextResponse.json({ error: { code: "INVALID_REQUEST", message, details } }, { status: 400 }); }
function versionConflict(currentVersion: number) { return NextResponse.json({ error: { code: "VERSION_CONFLICT", message: "Watchlist version changed", details: { currentVersion } } }, { status: 412 }); }
