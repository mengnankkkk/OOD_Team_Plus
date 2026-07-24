export interface SearchFilters {
  limit?: number;
  dateFrom?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export const BLOCKED_PATTERNS = [
  /^localhost/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /^metadata\.google\.internal/i,
];

export function isSSRFBlocked(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return BLOCKED_PATTERNS.some((pattern) => pattern.test(hostname));
  } catch {
    return true;
  }
}

export async function searchWeb(query: string, filters: SearchFilters = {}): Promise<SearchResult[]> {
  const limit = Math.min(Math.max(filters.limit ?? 5, 1), 20);
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { Accept: "text/html", "User-Agent": "MoneyWhisperer/1.0" }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) return [];
  const html = await response.text();
  const results: SearchResult[] = [];
  const pattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/giu;
  for (const match of html.matchAll(pattern)) {
    const url = decodeHtml(match[1]);
    if (isSSRFBlocked(url) || !/^https?:\/\//iu.test(url)) continue;
    results.push({ title: stripHtml(decodeHtml(match[2])), url, snippet: stripHtml(decodeHtml(match[3])).slice(0, 500), source: "WEB" });
    if (results.length >= limit) break;
  }
  return results;
}

function stripHtml(value: string): string { return value.replace(/<[^>]*>/gu, "").replace(/\s+/gu, " ").trim(); }
function decodeHtml(value: string): string { return value.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">"); }
