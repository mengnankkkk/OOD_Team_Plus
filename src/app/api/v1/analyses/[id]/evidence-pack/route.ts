import { NextRequest, NextResponse } from "next/server";

import { formatRecommendation } from "@/server/extensions/advisor/recommendations";
import { getSseEvents } from "@/server/extensions/sse/event-persister";
import { getDatabase, getRequestContext, meta, parseJson } from "@/server/http/context";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = getRequestContext(req);
  const db = getDatabase();
  const run = db.prepare("SELECT * FROM agent_runs WHERE id=? AND user_id=?").get(id, userId) as Record<string, unknown> | undefined;
  if (!run) {
    db.close();
    return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Analysis not found" } }, { status: 404 });
  }
  const recommendations = db.prepare("SELECT * FROM recommendations WHERE analysis_id=? AND user_id=? ORDER BY created_at").all(id, userId) as Array<Record<string, unknown>>;
  const evidence = recommendations.length
    ? db.prepare("SELECT * FROM evidence_items WHERE user_id=? AND recommendation_id IN (" + recommendations.map(() => "?").join(",") + ") ORDER BY created_at").all(userId, ...recommendations.map((item) => item.id))
    : [];
  db.close();
  return NextResponse.json({
    data: {
      analysis: { analysisId: id, type: String(run.type).toUpperCase(), status: String(run.status).toUpperCase(), createdAt: run.created_at, completedAt: run.completed_at },
      recommendations: recommendations.map(formatRecommendation),
      evidence,
      compliance: parseJson(run.compliance_json as string, {}),
      result: parseJson(run.result_json as string, {}),
      events: getSseEvents(id).map((event) => ({ id: event.id, type: event.type, payload: event.payload, createdAt: event.createdAt })),
      missingEvidence: recommendations.length ? [] : ["该分析没有生成交易建议卡。"],
    },
    meta: meta(),
  });
}
