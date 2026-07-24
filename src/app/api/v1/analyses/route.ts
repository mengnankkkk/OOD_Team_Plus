import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createAndRunDataQuery } from "@/server/extensions/query/service";
import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";
import { getRequestContext, idempotencyKey, meta } from "@/server/http/context";

const Schema = z.object({
  type: z.enum(["STOCK_DIAGNOSTIC", "PORTFOLIO_DIAGNOSTIC", "HOLDING_REVIEW", "STOCK_SUITABILITY_SCREEN"]),
  conversationId: z.string().optional(),
  input: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(req: NextRequest) {
  const key = idempotencyKey(req);
  if (!key) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } }, { status: 400 });
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid analysis request", details: parsed.error.format() } }, { status: 422 });
  const { userId } = getRequestContext(req);
  const idem = await beginIdempotentRequest(userId, "analysis_create", key, parsed.data);
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  try {
    const question = String(parsed.data.input.question ?? (parsed.data.type === "PORTFOLIO_DIAGNOSTIC" ? "分析当前组合健康度和风险度" : "分析当前持仓指标和风险"));
    const query = await createAndRunDataQuery({ userId, sessionId: parsed.data.conversationId, questionText: question, requestedDatasets: ["PORTFOLIO_HOLDINGS", "PORTFOLIO_METRICS"], outputMode: "SQL_ONLY", requestedLimit: 2000 });
    const payload = { data: { id: query.analysisId, analysisId: query.analysisId, type: parsed.data.type, status: "COMPLETED", result: { dataQueryId: query.queryId, rowCount: query.result.rowCount }, streamUrl: `/api/v1/analyses/${query.analysisId}/events` }, meta: meta() };
    await saveIdempotentResponse(userId, "analysis_create", key, idem.requestHash, payload);
    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: { code: "ANALYSIS_FAILED", message: error instanceof Error ? error.message : "Analysis failed", retryable: false } }, { status: 422 });
  }
}
