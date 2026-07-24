import { NextRequest, NextResponse } from "next/server";

import { getDatabase, getRequestContext, meta } from "@/server/http/context";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM agent_runs WHERE id = ? AND user_id = ?").get(id, getRequestContext(req).userId) as Record<string, unknown> | undefined;
  db.close();
  if (!row) return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Analysis not found" } }, { status: 404 });
  return NextResponse.json({ data: { analysisId: row.id, type: String(row.type).toUpperCase(), status: String(row.status).toUpperCase(), createdAt: row.created_at, completedAt: row.completed_at, streamUrl: `/api/v1/analyses/${id}/events` }, meta: meta() });
}
