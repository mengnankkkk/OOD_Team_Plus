import { searchAbortSignal, type SearchFilters, type SearchResult } from "./web-adapter";

export async function searchMCP(query: string, filters: SearchFilters = {}): Promise<SearchResult[]> {
  const firecrawlApiKey = process.env.FIRECRAWL_API_KEY?.trim();
  const firecrawlEndpoint = process.env.FIRECRAWL_SEARCH_URL?.trim();
  if (firecrawlApiKey || firecrawlEndpoint) {
    return searchFirecrawl(query, filters, firecrawlEndpoint, firecrawlApiKey);
  }

  const endpoint = process.env.MCP_SEARCH_URL?.trim();
  if (!endpoint) return [];
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit: filters.limit ?? 5 }),
    signal: searchAbortSignal(filters),
  });
  if (!response.ok) throw new Error(`MCP_HTTP_${response.status}`);
  const data = await response.json() as { results?: Array<{ title?: string; url?: string; snippet?: string }> };
  return (data.results ?? []).slice(0, filters.limit ?? 5).map((item) => ({ title: item.title ?? "MCP result", url: item.url ?? "mcp://unknown", snippet: item.snippet ?? "", source: "MCP" }));
}

async function searchFirecrawl(
  query: string,
  filters: SearchFilters,
  endpoint = "https://api.firecrawl.dev/v2/search",
  apiKey?: string,
): Promise<SearchResult[]> {
  const limit = filters.limit ?? 5;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, limit, sources: [{ type: "web" }] }),
    signal: searchAbortSignal(filters),
  });
  if (!response.ok) throw new Error(`FIRECRAWL_HTTP_${response.status}`);

  const data = await response.json() as {
    data?: {
      web?: Array<{ title?: string; url?: string; description?: string; snippet?: string; markdown?: string }>;
    };
  };

  return (data.data?.web ?? []).slice(0, limit).map((item) => ({
    title: item.title ?? "Firecrawl result",
    url: item.url ?? "https://firecrawl.dev",
    snippet: item.snippet ?? item.description ?? item.markdown?.slice(0, 500) ?? "",
    source: "MCP",
  }));
}
