import { NextRequest, NextResponse } from "next/server";

import { getRequestContext, meta } from "@/server/http/context";
import { getDataQuery } from "@/server/extensions/query/service";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const query = getDataQuery(getRequestContext(req).userId, id);
  if (!query) return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Data query not found" } }, { status: 404 });
  return NextResponse.json({ data: {
    id: query.id,
    question: query.question_text,
    status: String(query.status).toUpperCase(),
    analysisId: query.agent_run_id,
    plan: query.plan,
    sql: { dialect: "SQLITE", statement: query.redacted_sql, parameterTypes: JSON.parse(String(query.parameter_types_json ?? "[]")), safetyChecks: JSON.parse(String(query.safety_checks_json ?? "[]")) },
    result: { rowCount: query.row_count, truncated: Boolean(query.is_truncated), expiresAt: query.result_expires_at },
    sources: JSON.parse(String(query.source_summary_json ?? "[]")),
    failure: query.failure_code ? { code: query.failure_code, message: query.failure_message, retryable: false } : null,
  }, meta: meta() });
}
