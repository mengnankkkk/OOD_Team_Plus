import { searchAbortSignal, type SearchFilters, type SearchResult } from "./web-adapter";

export async function searchMCP(query: string, filters: SearchFilters = {}): Promise<SearchResult[]> {
  const firecrawlApiKey = process.env.FIRECRAWL_API_KEY?.trim();
  const firecrawlEndpoint = process.env.FIRECRAWL_SEARCH_URL?.trim();
  const endpoint = process.env.MCP_SEARCH_URL?.trim();
  if (firecrawlApiKey || firecrawlEndpoint) {
    try {
      const results = await searchFirecrawl(query, filters, firecrawlEndpoint, firecrawlApiKey);
      if (results.length || !endpoint) return results;
    } catch (error) {
      if (!endpoint) throw error;
    }
  }

  if (!endpoint) throw new Error("MCP_NOT_CONFIGURED");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, limit: filters.limit ?? 5 }),
    signal: searchAbortSignal(filters),
  });
  const payload = await readJsonResponse(response, "MCP");
  return normalizeSearchResults(payload, filters.limit ?? 5);
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
  const payload = await readJsonResponse(response, "Firecrawl");
  return normalizeSearchResults(payload, limit).map((result) => ({ ...result, source: "MCP" }));
}

async function readJsonResponse(response: Response, source: string): Promise<unknown> {
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${source}_HTTP_${response.status}${body ? `: ${body.slice(0, 180)}` : ""}`);
  }
  if (!body.trim()) return [];
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(`${source}_INVALID_JSON`);
  }
}

function normalizeSearchResults(payload: unknown, limit: number): SearchResult[] {
  return extractResultRecords(payload)
    .map((record) => ({
      title: firstString(record.title, record.name, record.heading) ?? "研究搜索结果",
      url: firstString(record.url, record.link, record.source_url) ?? "mcp://unknown",
      snippet: (firstString(record.snippet, record.description, record.summary, record.content, record.markdown, record.text) ?? "").slice(0, 500),
      source: "MCP",
    }))
    .filter((result) => result.snippet || result.url !== "mcp://unknown")
    .slice(0, Math.min(Math.max(limit, 1), 20));
}

function extractResultRecords(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  for (const key of ["results", "items", "documents", "web"]) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  for (const key of ["data", "result"]) {
    const records = extractResultRecords(payload[key]);
    if (records.length) return records;
  }
  if (Array.isArray(payload.content)) {
    return payload.content.flatMap((item) => {
      if (!isRecord(item)) return [];
      const text = firstString(item.text, item.content);
      if (!text) return [];
      try {
        return extractResultRecords(JSON.parse(text) as unknown);
      } catch {
        return [{ title: "研究搜索结果", snippet: text, url: "mcp://content" }];
      }
    });
  }
  return [];
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
