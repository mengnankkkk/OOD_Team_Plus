import { XMLParser } from "fast-xml-parser";

import { persistSseEvent } from "@/server/extensions/sse/event-persister";
import { fetchPublicHttpUrl } from "@/server/extensions/security/public-url";
import { createId, getDatabase, isoNow, json } from "@/server/http/context";

const MAX_RSS_BYTES = 2 * 1024 * 1024;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: false, trimValues: true });

interface FeedRow extends Record<string, unknown> {
  id: string;
  url: string;
  etag?: string;
  last_modified?: string;
}

interface ParsedItem {
  guid: string;
  title: string;
  link: string | null;
  summary: string | null;
  author: string | null;
  publishedAt: string | null;
  categories: string[];
}

export async function syncRssFeed(feedId: string, userId: string, options: { force?: boolean } = {}) {
  const db = getDatabase();
  const feed = db.prepare("SELECT * FROM rss_feeds WHERE id=? AND status!='deleted'").get(feedId) as FeedRow | undefined;
  if (!feed) {
    db.close();
    throw new Error("Feed not found");
  }
  const running = db.prepare("SELECT id FROM agent_runs WHERE user_id=? AND type='rss_sync' AND status IN ('queued','running') LIMIT 1").get(userId);
  if (running) {
    db.close();
    throw new Error("RSS sync already running");
  }
  const analysisId = createId("analysis");
  const startedAt = isoNow();
  db.prepare("INSERT INTO agent_runs (id,user_id,type,status,created_at,result_json) VALUES (?,?,?,'running',?,?)").run(analysisId, userId, "rss_sync", startedAt, json({ feedId }));
  db.close();
  persistSseEvent({ analysisId, type: "agent.started", payload: { type: "RSS_SYNC", feedId } });

  try {
    const headers: Record<string, string> = { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" };
    if (!options.force && feed.etag) headers["If-None-Match"] = feed.etag;
    if (!options.force && feed.last_modified) headers["If-Modified-Since"] = feed.last_modified;
    const response = await fetchPublicHttpUrl(feed.url, { headers, signal: AbortSignal.timeout(10_000) });
    if (response.status === 304) return finishSync(feedId, userId, analysisId, [], response, true);
    if (!response.ok) throw new Error(`RSS returned ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_RSS_BYTES) throw new Error("RSS response is too large");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_RSS_BYTES) throw new Error("RSS response is too large");
    const xml = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const items = parseFeed(xml).slice(0, 200);
    return finishSync(feedId, userId, analysisId, items, response, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : "RSS sync failed";
    const failureDb = getDatabase();
    failureDb.prepare("UPDATE rss_feeds SET status='error',last_error_message=?,updated_at=? WHERE id=?").run(message.slice(0, 500), isoNow(), feedId);
    failureDb.prepare("UPDATE agent_runs SET status='failed',completed_at=?,failure_code='RSS_UPSTREAM_FAILED',failure_message=? WHERE id=? AND user_id=?").run(isoNow(), message.slice(0, 500), analysisId, userId);
    failureDb.close();
    persistSseEvent({ analysisId, type: "agent.failed", payload: { code: "RSS_UPSTREAM_FAILED", retryable: true } });
    throw error;
  }
}

function finishSync(feedId: string, userId: string, analysisId: string, items: ParsedItem[], response: Response, notModified: boolean) {
  const now = isoNow();
  const db = getDatabase();
  let newCount = 0;
  let updatedCount = 0;
  const publish = db.transaction(() => {
    for (const item of items) {
      const exists = db.prepare("SELECT id FROM rss_items WHERE feed_id=? AND guid=?").get(feedId, item.guid);
      const result = db.prepare(`INSERT INTO rss_items (id,feed_id,guid,title,link,summary,author,published_at,categories_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(feed_id,guid) DO UPDATE SET title=excluded.title,link=excluded.link,summary=excluded.summary,author=excluded.author,published_at=excluded.published_at,categories_json=excluded.categories_json`).run(
        createId("rss_item"), feedId, item.guid, item.title, item.link, item.summary, item.author, item.publishedAt, json(item.categories), now,
      );
      if (result.changes) {
        if (exists) updatedCount += 1;
        else newCount += 1;
      }
    }
    db.prepare("UPDATE rss_feeds SET last_synced_at=?,updated_at=?,status='active',etag=?,last_modified=?,last_error_message=NULL WHERE id=?").run(now, now, response.headers.get("etag"), response.headers.get("last-modified"), feedId);
    db.prepare("UPDATE agent_runs SET status='completed',completed_at=?,result_json=? WHERE id=? AND user_id=?").run(now, json({ feedId, newCount, updatedCount, notModified }), analysisId, userId);
  });
  publish();
  db.close();
  persistSseEvent({ analysisId, type: "rss.synced", payload: { feedId, newCount, updatedCount, notModified } });
  persistSseEvent({ analysisId, type: "agent.completed", payload: { type: "RSS_SYNC", feedId } });
  return { feedId, analysisId, newCount, updatedCount, notModified, status: "COMPLETED" as const };
}

function parseFeed(xml: string): ParsedItem[] {
  const document = parser.parse(xml) as Record<string, unknown>;
  const rssChannel = asObject(asObject(document.rss)?.channel);
  const rssItems = asArray(rssChannel?.item);
  const atomFeed = asObject(document.feed);
  const atomItems = asArray(atomFeed?.entry);
  return [...rssItems, ...atomItems].flatMap((raw) => {
    const item = asObject(raw);
    if (!item) return [];
    const title = cleanText(item.title).slice(0, 500);
    const link = readLink(item.link);
    const guid = cleanText(item.guid) || cleanText(item.id) || link || title;
    if (!title || !guid) return [];
    const summary = (cleanText(item.description) || cleanText(item.summary) || cleanText(item.content)).slice(0, 4000) || null;
    const published = cleanText(item.pubDate) || cleanText(item.published) || cleanText(item.updated);
    return [{ guid: guid.slice(0, 1000), title, link, summary, author: cleanText(item.author).slice(0, 300) || null, publishedAt: parseDate(published), categories: asArray(item.category).map(cleanText).filter(Boolean).slice(0, 20) }];
  });
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asArray(value: unknown): unknown[] {
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
}

function cleanText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim();
  const object = asObject(value);
  return object ? cleanText(object["#text"] ?? object.name ?? "") : "";
}

function readLink(value: unknown): string | null {
  if (typeof value === "string") return value.trim().slice(0, 2000) || null;
  for (const entry of asArray(value)) {
    const object = asObject(entry);
    const href = cleanText(object?.["@_href"] ?? object?.["#text"] ?? entry);
    if (href) return href.slice(0, 2000);
  }
  return null;
}

function parseDate(value: string): string | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
