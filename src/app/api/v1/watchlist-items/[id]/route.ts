import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getDatabase, getRequestContext, isoNow, meta } from "@/server/http/context";

const PatchSchema = z.object({
  reason: z.string().max(500).nullable().optional(),
  plannedHorizon: z.enum(["SHORT", "MEDIUM", "LONG"]).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const expectedVersion = parseVersion(req);
  if (expectedVersion === null) return invalid("A numeric If-Match header is required");
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid("Invalid watchlist item update", parsed.error.format());
  const { userId } = getRequestContext(req);
  const db = getDatabase();
  const row = db.prepare(`SELECT wi.row_version FROM watchlist_items wi JOIN watchlists w ON w.id=wi.watchlist_id
    WHERE wi.id=? AND wi.status='active' AND w.user_id=? AND w.status!='deleted'`).get(id, userId) as { row_version: number } | undefined;
  if (!row) { db.close(); return notFound(); }
  const result = db.prepare(`UPDATE watchlist_items SET
      reason=CASE WHEN ? THEN ? ELSE reason END,planned_horizon=CASE WHEN ? THEN ? ELSE planned_horizon END,
      updated_at=?,row_version=row_version+1 WHERE id=? AND status='active' AND row_version=?`).run(
    Object.hasOwn(parsed.data, "reason") ? 1 : 0, parsed.data.reason ?? null,
    Object.hasOwn(parsed.data, "plannedHorizon") ? 1 : 0, parsed.data.plannedHorizon ?? null,
    isoNow(), id, expectedVersion,
  );
  if (!result.changes) { db.close(); return versionConflict(row.row_version); }
  const updated = db.prepare("SELECT * FROM watchlist_items WHERE id=?").get(id);
  db.close();
  return NextResponse.json({ data: updated, meta: meta() });
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const expectedVersion = parseVersion(req);
  if (expectedVersion === null) return invalid("A numeric If-Match header is required");
  const { userId } = getRequestContext(req);
  const db = getDatabase();
  const row = db.prepare(`SELECT wi.status,wi.row_version FROM watchlist_items wi JOIN watchlists w ON w.id=wi.watchlist_id
    WHERE wi.id=? AND w.user_id=?`).get(id, userId) as { status: string; row_version: number } | undefined;
  if (!row || row.status !== "active") { db.close(); return new Response(null, { status: 204 }); }
  const result = db.prepare("UPDATE watchlist_items SET status='removed',removed_at=?,updated_at=?,row_version=row_version+1 WHERE id=? AND row_version=?").run(isoNow(), isoNow(), id, expectedVersion);
  db.close();
  return result.changes ? new Response(null, { status: 204 }) : versionConflict(row.row_version);
}

function parseVersion(req: NextRequest): number | null {
  const value = Number.parseInt(req.headers.get("If-Match")?.replaceAll('"', "") ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function invalid(message: string, details?: unknown) { return NextResponse.json({ error: { code: "INVALID_REQUEST", message, details } }, { status: 400 }); }
function notFound() { return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Watchlist item not found" } }, { status: 404 }); }
function versionConflict(currentVersion: number) { return NextResponse.json({ error: { code: "VERSION_CONFLICT", message: "Watchlist item version changed", details: { currentVersion } } }, { status: 412 }); }
