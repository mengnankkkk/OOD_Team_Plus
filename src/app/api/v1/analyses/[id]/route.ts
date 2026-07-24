import { NextRequest, NextResponse } from "next/server";

import { getDatabase, getRequestContext, meta } from "@/server/http/context";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM agent_runs WHERE id = ? AND user_id = ?").get(id, getRequestContext(req).userId) as Record<string, unknown> | undefined;
  db.close();
  if (!row) return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Analysis not found" } }, { status: 404 });
  const result = row.result_json ? JSON.parse(String(row.result_json)) as Record<string, unknown> : null;
  const compliance = row.compliance_json ? JSON.parse(String(row.compliance_json)) : null;
  return NextResponse.json({ data: { id: row.id, analysisId: row.id, type: String(row.type).toUpperCase(), status: String(row.status).toUpperCase(), stage: row.status === "completed" ? "FINALIZED" : String(row.status).toUpperCase(), progress: row.status === "completed" ? 1 : 0, createdAt: row.created_at, completedAt: row.completed_at, result, compliance, failure: row.failure_code ? { code: row.failure_code, message: row.failure_message, retryable: true } : null, streamUrl: `/api/v1/analyses/${id}/events` }, meta: meta() });
}
