import { persistSseEvent } from "@/server/extensions/sse/event-persister";
import { createId, getDatabase, isoNow, json } from "@/server/http/context";

import { searchKnowledgeBase } from "./knowledge-base-adapter";
import { searchMCP } from "./mcp-adapter";
import { searchRSS } from "./rss-adapter";
import { searchWeb, type SearchResult } from "./web-adapter";

export type ResearchAdapter = "WEB" | "MCP" | "KNOWLEDGE_BASE" | "RSS";

const searchAdapters: Record<ResearchAdapter, (query: string, filters: { limit: number }) => Promise<SearchResult[]>> = {
  WEB: searchWeb,
  MCP: searchMCP,
  KNOWLEDGE_BASE: searchKnowledgeBase,
  RSS: searchRSS,
};

export async function runResearchSearch(input: { userId: string; query: string; adapters: ResearchAdapter[]; maximumResults: number }) {
  const searchId = createId("search");
  const analysisId = createId("analysis");
  const now = isoNow();
  const db = getDatabase();
  db.prepare("INSERT INTO research_searches (id,user_id,query_text,adapters_json,status,created_at) VALUES (?,?,?,?,?,?)").run(searchId, input.userId, input.query, json(input.adapters), "running", now);
  db.prepare("INSERT INTO agent_runs (id,user_id,type,status,created_at,result_json) VALUES (?,?,?,?,?,?)").run(analysisId, input.userId, "research_search", "running", now, json({ searchId }));
  db.close();
  const collected = await Promise.all(input.adapters.map(async (adapter) => {
    try {
      return { adapter, status: "succeeded", results: await searchAdapters[adapter](input.query, { limit: input.maximumResults }), error: null };
    } catch (error) {
      return { adapter, status: "failed", results: [] as SearchResult[], error: { code: `${adapter}_UNAVAILABLE`, message: error instanceof Error ? error.message : "Search source failed", retryable: true } };
    }
  }));
  const write = getDatabase();
  let resultCount = 0;
  for (const group of collected) {
    for (const result of group.results) {
      resultCount += 1;
      write.prepare("INSERT INTO research_results (id,search_id,adapter,title,url,snippet,citation,created_at) VALUES (?,?,?,?,?,?,?,?)").run(createId("research_result"), searchId, group.adapter.toLowerCase(), result.title, result.url, result.snippet.slice(0, 500), result.url, now);
      write.prepare("INSERT INTO evidence_items (id,user_id,kind,title,summary,source,source_url,created_at) VALUES (?,?,?,?,?,?,?,?)").run(createId("evidence"), input.userId, "RESEARCH", result.title, result.snippet.slice(0, 500), group.adapter, result.url, now);
    }
    write.prepare("INSERT INTO research_search_sources (id,search_id,adapter,status,result_count,error_json,completed_at) VALUES (?,?,?,?,?,?,?)").run(createId("search_source"), searchId, group.adapter.toLowerCase(), group.status, group.results.length, group.error ? json(group.error) : null, isoNow());
    persistSseEvent({ analysisId, type: "search.source.completed", payload: { searchId, adapter: group.adapter, resultCount: group.results.length, status: group.status } });
  }
  const succeeded = resultCount > 0;
  const completedAt = isoNow();
  write.prepare("UPDATE research_searches SET status=?,completed_at=? WHERE id=?").run(succeeded ? "succeeded" : "failed", completedAt, searchId);
  write.prepare("UPDATE agent_runs SET status=?,completed_at=?,result_json=? WHERE id=?").run(succeeded ? "completed" : "failed", completedAt, json({ searchId, resultCount }), analysisId);
  write.close();
  persistSseEvent({ analysisId, type: succeeded ? "agent.completed" : "agent.failed", payload: { type: "RESEARCH_SEARCH", searchId, resultCount } });
  return { searchId, analysisId, resultCount, status: succeeded ? "COMPLETED" as const : "FAILED" as const, sourceStatuses: collected.map((group) => ({ adapter: group.adapter, status: group.status.toUpperCase(), error: group.error })) };
}
