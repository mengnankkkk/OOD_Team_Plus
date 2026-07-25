import type { SearchFilters, SearchResult } from "./web-adapter";
import { sanitizeRssText } from "@/server/extensions/rss/text";
import { getDatabase } from "@/server/http/context";

export async function searchRSS(query: string, filters: SearchFilters = {}): Promise<SearchResult[]> {
  const db = getDatabase();
  const terms = query.match(/[\u4e00-\u9fff]{2,}|[A-Za-z]{2,}\d*|\d{6}(?:\.[A-Z]{2})?/gu) ?? [];
  const searchTerms = [...new Set(terms.map((term) => term.trim()).filter(Boolean))].slice(0, 24);
  const effectiveTerms = searchTerms.length ? searchTerms : [query];
  const where = effectiveTerms.map(() => "(title LIKE ? OR summary LIKE ?)").join(" OR ");
  const params = effectiveTerms.flatMap((term) => [`%${term}%`, `%${term}%`]);
  const rows = db.prepare(`SELECT title, link, summary FROM rss_items WHERE ${where} ORDER BY published_at DESC LIMIT ?`)
    .all(...params, Math.min(filters.limit ?? 5, 20)) as Array<{ title: string; link: string | null; summary: string | null }>;
  db.close();
  return rows.map((row) => ({ title: sanitizeRssText(row.title), url: row.link ?? "rss://local", snippet: sanitizeRssText(row.summary), source: "RSS" }));
}
