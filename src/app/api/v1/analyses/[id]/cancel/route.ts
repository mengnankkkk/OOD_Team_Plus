import { NextRequest, NextResponse } from "next/server";

import { getDatabase, getRequestContext, isoNow, meta } from "@/server/http/context";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDatabase();
  const result = db.prepare("UPDATE agent_runs SET status = 'cancelled', completed_at = ? WHERE id = ? AND user_id = ? AND status IN ('queued','running')").run(isoNow(), id, getRequestContext(req).userId);
  if (!result.changes) {
    const row = db.prepare("SELECT status FROM agent_runs WHERE id = ? AND user_id = ?").get(id, getRequestContext(req).userId) as { status?: string } | undefined;
    db.close();
    return NextResponse.json({ error: { code: row ? "ANALYSIS_NOT_CANCELLABLE" : "RESOURCE_NOT_FOUND", message: row ? "Analysis is already terminal" : "Analysis not found" } }, { status: row ? 409 : 404 });
  }
  db.close();
  return NextResponse.json({ data: { analysisId: id, status: "CANCELLED" }, meta: meta() });
}
