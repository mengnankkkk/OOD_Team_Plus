import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authError, requireAdmin } from "@/server/auth/http";
import { getDatabase, getRequestContext, isoNow, meta } from "@/server/http/context";
import { formatFeed, validateSourceUrls } from "../route";

const UpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  feedUrl: z.string().url().optional(),
  siteUrl: z.string().url().nullable().optional(),
  enabled: z.boolean().optional(),
  refreshIntervalMinutes: z.number().int().min(5).max(10_080).optional(),
  description: z.string().trim().max(500).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try { requireAdmin(getRequestContext(req).user); } catch (error) { return authError(error); }
  const { id } = await params;
  const expectedVersion = parseVersion(req);
  if (expectedVersion === null) return invalidVersion();
  const parsed = UpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid feed update", details: parsed.error.format() } }, { status: 422 });
  const db = getDatabase();
  const current = db.prepare("SELECT * FROM rss_feeds WHERE id=? AND status!='deleted'").get(id) as Record<string, unknown> | undefined;
  if (!current) { db.close(); return notFound(); }
  const feedUrl = parsed.data.feedUrl ?? String(current.url);
  const siteUrl = parsed.data.siteUrl === undefined ? current.site_url as string | null | undefined : parsed.data.siteUrl;
  try {
    if (parsed.data.feedUrl || parsed.data.siteUrl !== undefined) await validateSourceUrls(feedUrl, siteUrl ?? undefined);
  } catch {
    db.close();
    return NextResponse.json({ error: { code: "UNSAFE_SOURCE_URL", message: "URL must resolve to a public HTTP(S) address" } }, { status: 422 });
  }
  const duplicate = db.prepare("SELECT id FROM rss_feeds WHERE url=? AND id<>?").get(feedUrl, id);
  if (duplicate) { db.close(); return NextResponse.json({ error: { code: "RSS_FEED_URL_EXISTS", message: "RSS feed URL already exists" } }, { status: 409 }); }
  const feedUrlChanged = feedUrl !== current.url;
  const result = db.prepare(`UPDATE rss_feeds SET
      url=?,site_url=?,title=?,description=?,status=?,sync_interval_minutes=?,
      etag=?,last_modified=?,last_error_message=?,updated_at=?,row_version=row_version+1
    WHERE id=? AND status!='deleted' AND row_version=?`).run(
    feedUrl,
    siteUrl ?? null,
    parsed.data.name ?? current.title,
    parsed.data.description === undefined ? current.description : parsed.data.description,
    parsed.data.enabled === undefined ? current.status : parsed.data.enabled ? "active" : "disabled",
    parsed.data.refreshIntervalMinutes ?? current.sync_interval_minutes,
    feedUrlChanged ? null : current.etag,
    feedUrlChanged ? null : current.last_modified,
    feedUrlChanged ? null : current.last_error_message,
    isoNow(), id, expectedVersion,
  );
  if (!result.changes) { db.close(); return versionConflict(current.row_version); }
  const updated = db.prepare("SELECT * FROM rss_feeds WHERE id=?").get(id) as Record<string, unknown>;
  db.close();
  return NextResponse.json({ data: formatFeed(updated), meta: meta() });
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try { requireAdmin(getRequestContext(req).user); } catch (error) { return authError(error); }
  const { id } = await params;
  const expectedVersion = parseVersion(req);
  if (expectedVersion === null) return invalidVersion();
  const db = getDatabase();
  const current = db.prepare("SELECT status,row_version FROM rss_feeds WHERE id=?").get(id) as { status?: string; row_version?: number } | undefined;
  if (!current) { db.close(); return notFound(); }
  if (current.status === "deleted") { db.close(); return new NextResponse(null, { status: 204 }); }
  const result = db.prepare("UPDATE rss_feeds SET status='deleted',deleted_at=?,updated_at=?,row_version=row_version+1 WHERE id=? AND status!='deleted' AND row_version=?").run(isoNow(), isoNow(), id, expectedVersion);
  db.close();
  if (!result.changes) return versionConflict(current.row_version);
  return new NextResponse(null, { status: 204 });
}

function parseVersion(req: NextRequest): number | null {
  const value = Number.parseInt(req.headers.get("If-Match")?.replaceAll('"', "") ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}
function invalidVersion() { return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "A numeric If-Match header is required" } }, { status: 400 }); }
function versionConflict(currentVersion: unknown) { return NextResponse.json({ error: { code: "VERSION_CONFLICT", message: "RSS feed version changed", details: { currentVersion } } }, { status: 412 }); }
function notFound() { return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Resource not found" } }, { status: 404 }); }
