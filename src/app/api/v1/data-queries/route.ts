import { NextRequest, NextResponse } from "next/server";

import { IdempotencyConflictError } from "@/server/extensions/middleware/idempotency";
import { runIdempotentAsync } from "@/server/extensions/middleware/idempotency-async";
import { getRequestContext, idempotencyKey, meta } from "@/server/http/context";
import { DataQueryRequestSchema } from "@/server/extensions/schemas";
import {
  createAndRunDataQuery,
  listDataQueries,
} from "@/server/extensions/query/service";
import {
  recoverDataQuery,
  type RecoveredDataQuery,
} from "@/server/extensions/query/recovery";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!idempotencyKey(req)) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key header required" } }, { status: 400 });
  const body = await req.json().catch(() => null);
  const parsed = DataQueryRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Invalid request body", details: parsed.error.format() } }, { status: 400 });

  const { userId } = getRequestContext(req);
  const key = idempotencyKey(req)!;
  try {
    const operation = await runIdempotentAsync(userId, "data_query", key, parsed.data, async () => {
      const result = await createAndRunDataQuery({
        userId,
        sessionId: parsed.data.conversationId,
        sourceMessageId: parsed.data.messageId,
        questionText: parsed.data.questionText,
        requestedDatasets: parsed.data.requestedDatasets,
        outputMode: parsed.data.outputMode,
        requestedLimit: parsed.data.requestedLimit,
        idempotencyKey: key,
        accountScope: parsed.data.accountScope,
      });
      return operationPayload(result);
    }, {
      recover: async () => {
        const recovered = recoverDataQuery(userId, key);
        if (recovered?.kind === "replay") {
          return { kind: "replay", value: operationPayload(recovered.result) };
        }
        return recovered;
      },
    });
    return NextResponse.json(operation.value, { status: operation.replayed ? 200 : 202 });
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return NextResponse.json(
        { error: { code: "IDEMPOTENCY_CONFLICT", message: error.message } },
        { status: 409 },
      );
    }
    const message = error instanceof Error ? error.message : "Query failed";
    const status = message === "Conversation not found" || message === "Source message not found" ? 404 : 422;
    return NextResponse.json({ error: { code: status === 404 ? "RESOURCE_NOT_FOUND" : "QUERY_REJECTED", message, retryable: false } }, { status });
  }
}

export async function GET(req: NextRequest) {
  const { userId } = getRequestContext(req);
  const raw = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 100) : 20;
  const requestedStatus = req.nextUrl.searchParams.get("status")?.toUpperCase();
  const status = requestedStatus ? ({ COMPLETED: "succeeded", SUCCEEDED: "succeeded", FAILED: "failed", RUNNING: "running", QUEUED: "queued", CANCELLED: "cancelled", INTERRUPTED: "interrupted" } as Record<string, string>)[requestedStatus] : undefined;
  if (requestedStatus && !status) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid query status" } }, { status: 422 });
  return NextResponse.json({ data: { items: listDataQueries(userId, limit, status) }, meta: meta({ pagination: { limit, nextCursor: null, hasMore: false } }) });
}

function analysisRef(analysisId: string, type: "DATA_QUERY", status: string) {
  return { analysisId, type, status, streamUrl: `/api/v1/analyses/${analysisId}/events` };
}

function operationPayload(result: RecoveredDataQuery) {
  return {
    data: {
      resourceId: result.queryId,
      analysis: analysisRef(result.analysisId, "DATA_QUERY", result.status),
      result: {
        rowCount: result.result.rowCount,
        truncated: result.result.isTruncated,
      },
      ...(result.artifact ? { artifact: result.artifact } : {}),
    },
    meta: meta(),
  };
}
