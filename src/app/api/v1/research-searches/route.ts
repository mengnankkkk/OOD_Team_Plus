import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { searchKnowledgeBase } from "@/server/extensions/search/knowledge-base-adapter";
import { searchMCP } from "@/server/extensions/search/mcp-adapter";
import { searchRSS } from "@/server/extensions/search/rss-adapter";
import { searchWeb, type SearchResult } from "@/server/extensions/search/web-adapter";
import { persistSseEvent } from "@/server/extensions/sse/event-persister";
import { createId, getDatabase, getRequestContext, idempotencyKey, isoNow, meta } from "@/server/http/context";

const Schema = z.object({ query: z.string().min(1).max(1000), adapters: z.array(z.enum(["WEB", "MCP", "KNOWLEDGE_BASE", "RSS"])).min(1).max(4).default(["KNOWLEDGE_BASE", "MCP"]), maximumResults: z.number().int().min(1).max(50).default(10) });
const adapters: Record<string, (query: string, filters: { limit: number }) => Promise<SearchResult[]>> = { WEB: searchWeb, MCP: searchMCP, KNOWLEDGE_BASE: searchKnowledgeBase, RSS: searchRSS };

export async function POST(req: NextRequest) {
  if (!idempotencyKey(req)) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } }, { status: 400 });
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Invalid search request", details: parsed.error.format() } }, { status: 400 });
  const { userId } = getRequestContext(req); const searchId = createId("search"); const analysisId = createId("analysis"); const now = isoNow();
  const db = getDatabase();
  db.prepare("INSERT INTO research_searches (id,user_id,query_text,adapters_json,status,created_at) VALUES (?,?,?,?,?,?)").run(searchId, userId, parsed.data.query, JSON.stringify(parsed.data.adapters), "running", now);
  db.prepare("INSERT INTO agent_runs (id,user_id,type,status,created_at) VALUES (?,?,?,?,?)").run(analysisId, userId, "research_search", "running", now); db.close();
  const collected = await Promise.all(parsed.data.adapters.map(async (adapter) => {
    try { return { adapter, status: "succeeded", results: await adapters[adapter](parsed.data.query, { limit: parsed.data.maximumResults }), error: null }; }
    catch (error) { return { adapter, status: "failed", results: [] as SearchResult[], error: { code: `${adapter}_UNAVAILABLE`, message: error instanceof Error ? error.message : "Search source failed", retryable: true } }; }
  }));
  const write = getDatabase(); let resultCount = 0;
  for (const group of collected) {
    for (const result of group.results) { const resultId = createId("research_result"); resultCount += 1; write.prepare("INSERT INTO research_results (id,search_id,adapter,title,url,snippet,citation,created_at) VALUES (?,?,?,?,?,?,?,?)").run(resultId, searchId, group.adapter.toLowerCase(), result.title, result.url, result.snippet.slice(0, 500), result.url, now); write.prepare("INSERT INTO evidence_items (id,user_id,kind,title,summary,source,source_url,created_at) VALUES (?,?,?,?,?,?,?,?)").run(createId("evidence"), userId, "RESEARCH", result.title, result.snippet.slice(0, 500), group.adapter, result.url, now); }
    write.prepare("INSERT INTO research_search_sources (id,search_id,adapter,status,result_count,error_json,completed_at) VALUES (?,?,?,?,?,?,?)").run(createId("search_source"), searchId, group.adapter.toLowerCase(), group.status, group.results.length, group.error ? JSON.stringify(group.error) : null, isoNow());
    persistSseEvent({ analysisId, type: "search.source.completed", payload: { searchId, adapter: group.adapter, resultCount: group.results.length, status: group.status } });
  }
  const status = resultCount > 0 ? "succeeded" : "failed"; const completedAt = isoNow();
  write.prepare("UPDATE research_searches SET status=?,completed_at=? WHERE id=?").run(status, completedAt, searchId); write.prepare("UPDATE agent_runs SET status=?,completed_at=? WHERE id=?").run(resultCount > 0 ? "completed" : "failed", completedAt, analysisId); write.close();
  return NextResponse.json({ data: { searchId, analysis: { analysisId, type: "RESEARCH_SEARCH", status: resultCount > 0 ? "COMPLETED" : "FAILED", streamUrl: `/api/v1/analyses/${analysisId}/events` }, resultCount, sourceStatuses: collected.map((group) => ({ adapter: group.adapter, status: group.status.toUpperCase(), error: group.error })) }, meta: meta() }, { status: 202 });
}

export async function GET(req: NextRequest) { const db = getDatabase(); const rows = db.prepare("SELECT id,query_text,status,created_at,completed_at FROM research_searches WHERE user_id=? ORDER BY created_at DESC LIMIT ?").all(getRequestContext(req).userId, 20); db.close(); return NextResponse.json({ data: { items: rows }, meta: meta() }); }
