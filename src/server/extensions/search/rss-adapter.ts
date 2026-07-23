import type { SearchFilters, SearchResult } from "./web-adapter";

export async function searchRSS(_query: string, _filters: SearchFilters = {}): Promise<SearchResult[]> {
  return [];
}
