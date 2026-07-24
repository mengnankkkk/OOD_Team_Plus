import { NextRequest, NextResponse } from "next/server";

import { createId, getDatabase, getRequestContext, isoNow, meta } from "@/server/http/context";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDatabase();
  const source = db.prepare("SELECT * FROM agent_runs WHERE id = ? AND user_id = ?").get(id, getRequestContext(req).userId) as Record<string, unknown> | undefined;
  if (!source) { db.close(); return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Analysis not found" } }, { status: 404 }); }
  const retryId = createId("analysis");
  db.prepare("INSERT INTO agent_runs (id, user_id, type, status, created_at) VALUES (?, ?, ?, 'queued', ?)").run(retryId, source.user_id, source.type, isoNow());
  db.close();
  return NextResponse.json({ data: { retryAnalysisId: retryId, analysisId: retryId, type: String(source.type).toUpperCase(), status: "QUEUED", streamUrl: `/api/v1/analyses/${retryId}/events` }, meta: meta() }, { status: 202 });
}
