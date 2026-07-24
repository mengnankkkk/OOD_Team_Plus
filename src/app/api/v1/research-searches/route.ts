import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";
import { runResearchSearch } from "@/server/extensions/search/service";
import { getDatabase, getRequestContext, idempotencyKey, meta } from "@/server/http/context";

const Schema = z.object({ query: z.string().min(1).max(1000), adapters: z.array(z.enum(["WEB", "MCP", "KNOWLEDGE_BASE", "RSS"])).min(1).max(4).default(["KNOWLEDGE_BASE", "MCP"]), maximumResults: z.number().int().min(1).max(50).default(10) });

export async function POST(req: NextRequest) {
  if (!idempotencyKey(req)) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } }, { status: 400 });
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Invalid search request", details: parsed.error.format() } }, { status: 400 });
  const { userId } = getRequestContext(req);
  const key = idempotencyKey(req)!;
  const idem = await beginIdempotentRequest(userId, "research_search", key, parsed.data);
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  const result = await runResearchSearch({ userId, ...parsed.data });
  const payload = { data: { searchId: result.searchId, analysis: { analysisId: result.analysisId, type: "RESEARCH_SEARCH", status: result.status, streamUrl: `/api/v1/analyses/${result.analysisId}/events` }, resultCount: result.resultCount, sourceStatuses: result.sourceStatuses }, meta: meta() };
  await saveIdempotentResponse(userId, "research_search", key, idem.requestHash, payload);
  return NextResponse.json(payload, { status: 202 });
}

export async function GET(req: NextRequest) {
  const db = getDatabase();
  const rows = db.prepare("SELECT id,query_text,status,created_at,completed_at FROM research_searches WHERE user_id=? ORDER BY created_at DESC LIMIT ?").all(getRequestContext(req).userId, 20);
  db.close();
  return NextResponse.json({ data: { items: rows }, meta: meta() });
}
