import { NextRequest, NextResponse } from "next/server";

import { getDatabase, getRequestContext, meta, parseJson } from "@/server/http/context";

export async function GET(req: NextRequest) {
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM decision_logs WHERE user_id=? ORDER BY created_at DESC LIMIT ?")
    .all(getRequestContext(req).userId, Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20), 100)) as Array<Record<string, unknown>>;
  db.close();
  return NextResponse.json({
    data: {
      items: rows.map((row) => {
        const payload = parseJson<Record<string, unknown>>(row.recommendation_json as string, {});
        const recommendation = payload.recommendation && typeof payload.recommendation === "object"
          ? payload.recommendation as Record<string, unknown>
          : payload;
        const recommendationId = payload.recommendationId ?? recommendation.id ?? null;
        const analysisId = payload.analysisId ?? recommendation.analysisId ?? null;
        return {
          id: row.id,
          recommendationId,
          analysisId,
          action: normalizeDecisionAction(row.action),
          reason: payload.reason ?? null,
          note: payload.note ?? null,
          recommendation,
          createdAt: row.created_at,
        };
      }),
    },
    meta: meta(),
  });
}

function normalizeDecisionAction(value: unknown) {
  const action = String(value ?? "").toUpperCase();
  if (action === "ACCEPT" || action === "SIMULATED") return "simulated";
  if (action === "REJECT" || action === "REJECTED") return "rejected";
  if (action === "REVOKE" || action === "REVOKED") return "revoked";
  if (action === "DEFER" || action === "LATER") return "later";
  if (action === "FOLLOWUP_QUESTION") return "followup_question";
  if (action === "COMMENTED") return "commented";
  return "viewed";
}
