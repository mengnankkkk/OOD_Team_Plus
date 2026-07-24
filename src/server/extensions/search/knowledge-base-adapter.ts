import type { SearchFilters, SearchResult } from "./web-adapter";

export async function searchKnowledgeBase(_query: string, _filters: SearchFilters = {}): Promise<SearchResult[]> {
  return [];
}
