import { NextRequest, NextResponse } from "next/server";

import { getRequestContext, idempotencyKey, meta, getDatabase, createId, isoNow, json } from "@/server/http/context";
import { DataQueryRequestSchema } from "@/server/extensions/schemas";
import { createAndRunDataQuery, listDataQueries } from "@/server/extensions/query/service";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!idempotencyKey(req)) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key header required" } }, { status: 400 });
  const body = await req.json().catch(() => null);
  const parsed = DataQueryRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Invalid request body", details: parsed.error.format() } }, { status: 400 });

  const { userId, sessionId } = getRequestContext(req);
  const key = idempotencyKey(req)!;
  const db = getDatabase();
  const existing = db.prepare("SELECT resource_id FROM idempotency_records WHERE user_id = ? AND operation = ? AND idempotency_key = ?").get(userId, "data_query", key) as { resource_id: string } | undefined;
  if (existing) {
    const query = db.prepare("SELECT agent_run_id FROM data_queries WHERE id = ?").get(existing.resource_id) as { agent_run_id: string } | undefined;
    (db as unknown as { close?: () => void }).close?.();
    return NextResponse.json({ data: { resourceId: existing.resource_id, analysis: analysisRef(query?.agent_run_id ?? createId("analysis"), "DATA_QUERY", "COMPLETED") }, meta: meta() }, { status: 200 });
  }
  (db as unknown as { close?: () => void }).close?.();

  try {
    const result = await createAndRunDataQuery({
      userId,
      sessionId: parsed.data.conversationId ?? sessionId ?? undefined,
      sourceMessageId: parsed.data.messageId,
      questionText: parsed.data.questionText,
      requestedDatasets: parsed.data.requestedDatasets,
      outputMode: parsed.data.outputMode,
      requestedLimit: parsed.data.requestedLimit,
      accountScope: parsed.data.accountScope,
    });
    const writeDb = getDatabase();
    writeDb.prepare("INSERT INTO idempotency_records (id, user_id, operation, idempotency_key, resource_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(createId("idem"), userId, "data_query", key, result.queryId, isoNow());
    (writeDb as unknown as { close?: () => void }).close?.();
    return NextResponse.json({ data: { resourceId: result.queryId, analysis: analysisRef(result.analysisId, "DATA_QUERY", result.status), result: { rowCount: result.result.rowCount, truncated: result.result.isTruncated } }, meta: meta() }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: { code: "QUERY_REJECTED", message: error instanceof Error ? error.message : "Query failed", retryable: false } }, { status: 422 });
  }
}

export async function GET(req: NextRequest) {
  const { userId } = getRequestContext(req);
  const raw = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 100) : 20;
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  return NextResponse.json({ data: { items: listDataQueries(userId, limit, status) }, meta: meta({ pagination: { limit, nextCursor: null, hasMore: false } }) });
}

function analysisRef(analysisId: string, type: "DATA_QUERY", status: string) {
  return { analysisId, type, status, streamUrl: `/api/v1/analyses/${analysisId}/events` };
}
