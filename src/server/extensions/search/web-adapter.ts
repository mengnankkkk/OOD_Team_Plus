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

export async function searchWeb(_query: string, _filters: SearchFilters = {}): Promise<SearchResult[]> {
  // TODO: wire to a real search API.
  return [];
}
