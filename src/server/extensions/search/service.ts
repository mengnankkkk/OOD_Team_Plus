import { persistSseEvent } from "@/server/extensions/sse/event-persister";
import { createId, getDatabase, isoNow, json } from "@/server/http/context";

import { searchKnowledgeBase } from "./knowledge-base-adapter";
import { searchMCP } from "./mcp-adapter";
import { searchRSS } from "./rss-adapter";
import { searchWeb, type SearchFilters, type SearchResult } from "./web-adapter";

export type ResearchAdapter = "WEB" | "MCP" | "KNOWLEDGE_BASE" | "RSS";
export type ResearchSearchResult = SearchResult & { adapter: ResearchAdapter };
export type ResearchSearchRunResult = {
  searchId: string;
  analysisId: string;
  resultCount: number;
  status: "COMPLETED" | "FAILED" | "CANCELED";
  results: ResearchSearchResult[];
  sourceStatuses: Array<{
    adapter: ResearchAdapter;
    status: string;
    resultCount: number;
    error: { code: string; message: string; retryable: boolean } | null;
  }>;
};

export type ResearchSearchInput = {
  userId: string;
  query: string;
  adapters: ResearchAdapter[];
  maximumResults: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  parentSearchId?: string;
  rootRunId?: string;
  sessionId?: string;
};

const searchAdapters: Record<ResearchAdapter, (query: string, filters: SearchFilters) => Promise<SearchResult[]>> = {
  WEB: searchWeb,
  MCP: searchMCP,
  KNOWLEDGE_BASE: searchKnowledgeBase,
  RSS: searchRSS,
};

export function startResearchSearch(input: ResearchSearchInput): {
  searchId: string;
  analysisId: string;
  status: "RUNNING";
  completion: Promise<ResearchSearchRunResult>;
} {
  const searchId = createId("search");
  const analysisId = createId("analysis");
  const now = isoNow();
  const db = getDatabase();
  db.prepare("INSERT INTO research_searches (id,user_id,query_text,adapters_json,status,created_at) VALUES (?,?,?,?,?,?)").run(searchId, input.userId, input.query, json(input.adapters), "running", now);
  db.prepare(`INSERT INTO agent_runs
    (id,user_id,type,status,session_id,root_run_id,agent_type,created_at,result_json)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    analysisId,
    input.userId,
    "research_search",
    "running",
    input.sessionId ?? null,
    input.rootRunId ?? null,
    "research_search",
    now,
    json({ searchId }),
  );
  db.close();
  const completion = executeResearchSearch(input, { searchId, analysisId, startedAt: now });
  return { searchId, analysisId, status: "RUNNING", completion };
}

export async function runResearchSearch(input: ResearchSearchInput): Promise<ResearchSearchRunResult> {
  return startResearchSearch(input).completion;
}

async function executeResearchSearch(
  input: ResearchSearchInput,
  run: { searchId: string; analysisId: string; startedAt: string },
): Promise<ResearchSearchRunResult> {
  let collected: Array<{
    adapter: ResearchAdapter;
    status: string;
    results: SearchResult[];
    error: { code: string; message: string; retryable: boolean } | null;
  }>;
  try {
    input.signal?.throwIfAborted();
    collected = await Promise.all(input.adapters.map(async (adapter) => {
      try {
        const results = await searchAdapters[adapter](input.query, {
          limit: input.maximumResults,
          timeoutMs: input.timeoutMs,
          signal: input.signal,
        });
        input.signal?.throwIfAborted();
        return { adapter, status: "succeeded", results, error: null };
      } catch (error) {
        if (input.signal?.aborted) throw error;
        return {
          adapter,
          status: "failed",
          results: [] as SearchResult[],
          error: {
            code: `${adapter}_UNAVAILABLE`,
            message: error instanceof Error ? error.message : "Search source failed",
            retryable: true,
          },
        };
      }
    }));
    input.signal?.throwIfAborted();
  } catch (error) {
    if (input.signal?.aborted) return cancelResearchRun(input, run);
    throw error;
  }

  const write = getDatabase();
  let resultCount = 0;
  try {
    input.signal?.throwIfAborted();
    for (const group of collected) {
      for (const result of group.results) {
        resultCount += 1;
        write.prepare("INSERT INTO research_results (id,search_id,adapter,title,url,snippet,citation,created_at) VALUES (?,?,?,?,?,?,?,?)").run(createId("research_result"), run.searchId, group.adapter.toLowerCase(), result.title, result.url, result.snippet.slice(0, 500), result.url, run.startedAt);
        write.prepare(`INSERT INTO evidence_items
          (id,user_id,agent_run_id,kind,stance,quality,title,summary,statement,source,source_url,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          createId("evidence"),
          input.userId,
          run.analysisId,
          "research_fact",
          "support",
          "medium",
          result.title,
          result.snippet.slice(0, 500),
          result.snippet.slice(0, 500),
          group.adapter,
          result.url,
          run.startedAt,
        );
      }
      write.prepare("INSERT INTO research_search_sources (id,search_id,adapter,status,result_count,error_json,completed_at) VALUES (?,?,?,?,?,?,?)").run(createId("search_source"), run.searchId, group.adapter.toLowerCase(), group.status, group.results.length, group.error ? json(group.error) : null, isoNow());
      persistSseEvent({ analysisId: run.analysisId, type: "search.source.completed", payload: { searchId: run.searchId, adapter: group.adapter, resultCount: group.results.length, status: group.status } });
    }
    input.signal?.throwIfAborted();
    const succeeded = resultCount > 0;
    const completedAt = isoNow();
    write.prepare("UPDATE research_searches SET status=?,completed_at=? WHERE id=? AND status='running'").run(succeeded ? "succeeded" : "failed", completedAt, run.searchId);
    write.prepare("UPDATE agent_runs SET status=?,completed_at=?,result_json=? WHERE id=? AND status='running'").run(succeeded ? "completed" : "failed", completedAt, json({ searchId: run.searchId, resultCount }), run.analysisId);
    persistSseEvent({ analysisId: run.analysisId, type: succeeded ? "agent.completed" : "agent.failed", payload: { type: "RESEARCH_SEARCH", searchId: run.searchId, resultCount } });
    return {
      searchId: run.searchId,
      analysisId: run.analysisId,
      resultCount,
      status: succeeded ? "COMPLETED" : "FAILED",
      results: collected.flatMap((group) => group.results.map((result) => ({ ...result, adapter: group.adapter }))),
      sourceStatuses: collected.map((group) => ({
        adapter: group.adapter,
        status: group.status.toUpperCase(),
        resultCount: group.results.length,
        error: group.error,
      })),
    };
  } catch (error) {
    if (input.signal?.aborted) {
      return cancelResearchRun(input, run);
    }
    throw error;
  } finally {
    write.close();
  }
}

function cancelResearchRun(
  input: ResearchSearchInput,
  run: { searchId: string; analysisId: string },
): ResearchSearchRunResult {
  const completedAt = isoNow();
  const db = getDatabase();
  db.prepare("UPDATE research_searches SET status='canceled',completed_at=? WHERE id=? AND status='running'")
    .run(completedAt, run.searchId);
  db.prepare("UPDATE agent_runs SET status='canceled',completed_at=?,result_json=? WHERE id=? AND status='running'")
    .run(completedAt, json({ searchId: run.searchId, canceled: true }), run.analysisId);
  db.close();
  persistSseEvent({
    analysisId: run.analysisId,
    type: "run.failed",
    payload: {
      type: "RESEARCH_SEARCH",
      searchId: run.searchId,
      status: "CANCELED",
      code: "CANCELED",
    },
  });
  return {
    searchId: run.searchId,
    analysisId: run.analysisId,
    resultCount: 0,
    status: "CANCELED",
    results: [],
    sourceStatuses: input.adapters.map((adapter) => ({
      adapter,
      status: "CANCELED",
      resultCount: 0,
      error: null,
    })),
  };
}
