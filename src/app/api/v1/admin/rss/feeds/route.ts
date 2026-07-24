import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";
import { assertPublicHttpUrl } from "@/server/extensions/security/public-url";
import { createId, DEMO_USER_ID, getDatabase, getRequestContext, idempotencyKey, isoNow, meta } from "@/server/http/context";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  feedUrl: z.string().url().optional(),
  siteUrl: z.string().url().optional(),
  enabled: z.boolean().default(true),
  refreshIntervalMinutes: z.number().int().min(5).max(10_080).default(60),
  description: z.string().trim().max(500).nullable().optional(),
  url: z.string().url().optional(),
  title: z.string().trim().min(1).max(200).optional(),
}).superRefine((value, context) => {
  if (!value.feedUrl && !value.url) context.addIssue({ code: z.ZodIssueCode.custom, path: ["feedUrl"], message: "feedUrl is required" });
});

export async function POST(req: NextRequest) {
  const userId = getRequestContext(req).userId;
  if (userId !== DEMO_USER_ID) return notFound();
  const key = idempotencyKey(req);
  if (!key) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } }, { status: 400 });
  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid feed", details: parsed.error.format() } }, { status: 422 });
  const feedUrl = parsed.data.feedUrl ?? parsed.data.url!;
  const name = parsed.data.name ?? parsed.data.title ?? feedUrl;
  const requestBody = { name, feedUrl, siteUrl: parsed.data.siteUrl ?? null, enabled: parsed.data.enabled, refreshIntervalMinutes: parsed.data.refreshIntervalMinutes, description: parsed.data.description ?? null };
  const routeCode = "admin_rss_feed_create";
  const idem = await beginIdempotentRequest(userId, routeCode, key, requestBody);
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  try {
    await validateSourceUrls(feedUrl, parsed.data.siteUrl);
  } catch {
    return unsafeUrl();
  }
  const now = isoNow();
  const db = getDatabase();
  const duplicate = db.prepare("SELECT id FROM rss_feeds WHERE url=?").get(feedUrl);
  if (duplicate) { db.close(); return NextResponse.json({ error: { code: "RSS_FEED_URL_EXISTS", message: "RSS feed URL already exists" } }, { status: 409 }); }
  const id = createId("feed");
  db.prepare(`INSERT INTO rss_feeds
    (id,url,site_url,title,description,status,sync_interval_minutes,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    id, feedUrl, parsed.data.siteUrl ?? null, name, parsed.data.description ?? null,
    parsed.data.enabled ? "active" : "disabled", parsed.data.refreshIntervalMinutes, userId, now, now,
  );
  const row = db.prepare("SELECT * FROM rss_feeds WHERE id=?").get(id) as Record<string, unknown>;
  db.close();
  const payload = { data: formatFeed(row), meta: meta() };
  await saveIdempotentResponse(userId, routeCode, key, idem.requestHash, payload);
  return NextResponse.json(payload, { status: 201 });
}

export async function GET(req: NextRequest) {
  if (getRequestContext(req).userId !== DEMO_USER_ID) return notFound();
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM rss_feeds WHERE status!='deleted' ORDER BY created_at DESC").all() as Array<Record<string, unknown>>;
  db.close();
  return NextResponse.json({ data: { items: rows.map(formatFeed) }, meta: meta() });
}

export function formatFeed(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.title,
    feedUrl: row.url,
    siteUrl: row.site_url,
    description: row.description,
    enabled: row.status === "active",
    status: String(row.status).toUpperCase(),
    refreshIntervalMinutes: row.sync_interval_minutes,
    lastSyncedAt: row.last_synced_at,
    lastErrorMessage: row.last_error_message,
    version: row.row_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function validateSourceUrls(feedUrl: string, siteUrl?: string) {
  await assertPublicHttpUrl(feedUrl);
  if (siteUrl) await assertPublicHttpUrl(siteUrl);
}

function unsafeUrl() { return NextResponse.json({ error: { code: "UNSAFE_SOURCE_URL", message: "URL must resolve to a public HTTP(S) address" } }, { status: 422 }); }
function notFound() { return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Resource not found" } }, { status: 404 }); }
