import type { SearchFilters, SearchResult } from "./web-adapter";

export async function searchMCP(query: string, filters: SearchFilters = {}): Promise<SearchResult[]> {
  const endpoint = process.env.MCP_SEARCH_URL?.trim();
  if (!endpoint) return [];
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, limit: filters.limit ?? 5 }), signal: AbortSignal.timeout(8_000) });
  if (!response.ok) return [];
  const data = await response.json() as { results?: Array<{ title?: string; url?: string; snippet?: string }> };
  return (data.results ?? []).slice(0, filters.limit ?? 5).map((item) => ({ title: item.title ?? "MCP result", url: item.url ?? "mcp://unknown", snippet: item.snippet ?? "", source: "MCP" }));
}
