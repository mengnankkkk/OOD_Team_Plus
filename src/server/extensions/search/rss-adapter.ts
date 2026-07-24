import type { SearchFilters, SearchResult } from "./web-adapter";
import { getDatabase } from "@/server/http/context";

export async function searchRSS(query: string, filters: SearchFilters = {}): Promise<SearchResult[]> {
  const db = getDatabase();
  const term = `%${query}%`;
  const rows = db.prepare("SELECT title, link, summary FROM rss_items WHERE title LIKE ? OR summary LIKE ? ORDER BY published_at DESC LIMIT ?").all(term, term, Math.min(filters.limit ?? 5, 20)) as Array<{ title: string; link: string | null; summary: string | null }>;
  db.close();
  return rows.map((row) => ({ title: row.title, url: row.link ?? "rss://local", snippet: row.summary ?? "", source: "RSS" }));
}
