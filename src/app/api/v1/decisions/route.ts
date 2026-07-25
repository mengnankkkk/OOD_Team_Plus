import { NextRequest, NextResponse } from "next/server";

import { getDatabase, getRequestContext, meta, pageParams, parseJson } from "@/server/http/context";

type Row = Record<string, unknown>;

const ACTIONS = new Set(["ACCEPT", "REJECT", "DEFER", "REVOKE", "FOLLOW_UP", "VIEWED", "COMMENT"]);

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function normalizedAction(value: unknown): string {
  const action = String(value ?? "VIEWED").toUpperCase();
  if (action === "SIMULATED") return "ACCEPT";
  if (action === "REJECTED") return "REJECT";
  if (action === "REVOKED") return "REVOKE";
  if (action === "LATER") return "DEFER";
  if (action === "FOLLOWUP_QUESTION") return "FOLLOW_UP";
  if (action === "COMMENTED") return "COMMENT";
  return action;
}

function publicAction(value: unknown): string {
  const action = String(value ?? "VIEWED").toUpperCase();
  if (action === "ACCEPT" || action === "SIMULATED") return "simulated";
  if (action === "REJECT" || action === "REJECTED") return "rejected";
  if (action === "REVOKE" || action === "REVOKED") return "revoked";
  if (action === "DEFER" || action === "LATER") return "later";
  if (action === "FOLLOW_UP" || action === "FOLLOWUP_QUESTION") return "followup_question";
  if (action === "COMMENT" || action === "COMMENTED") return "commented";
  return "viewed";
}

export async function GET(req: NextRequest) {
  const { userId } = getRequestContext(req);
  const { limit } = pageParams(req);
  const actionFilter = normalizedAction(req.nextUrl.searchParams.get("action"));
  const hasActionFilter = req.nextUrl.searchParams.has("action") && ACTIONS.has(actionFilter);
  const db = getDatabase();
  const rows = db.prepare(`SELECT * FROM decision_logs
    WHERE user_id=? ${hasActionFilter ? "AND UPPER(action)=?" : ""}
    ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(...(hasActionFilter ? [userId, actionFilter, limit] : [userId, limit])) as Row[];

  const items = rows.map((row) => {
    const payload = record(parseJson(String(row.recommendation_json ?? "{}"), {}));
    const recommendation = record(payload.recommendation ?? payload);
    const recommendationId = recommendation.id == null ? null : String(recommendation.id);
    const conversationId = row.conversation_id == null
      ? recommendation.conversationId == null ? null : String(recommendation.conversationId)
      : String(row.conversation_id);
    const analysisId = recommendation.analysisId == null ? null : String(recommendation.analysisId);
    const current = recommendationId
      ? db.prepare("SELECT status,updated_at FROM recommendations WHERE id=? AND user_id=? AND status!='deleted'").get(recommendationId, userId) as Row | undefined
      : undefined;
    const instrument = recommendation.instrumentId
      ? db.prepare("SELECT symbol,name,market,asset_type FROM instruments WHERE id=?").get(String(recommendation.instrumentId)) as Row | undefined
      : undefined;
    const conversation = conversationId
      ? db.prepare("SELECT title FROM conversation_sessions WHERE id=? AND user_id=?").get(conversationId, userId) as Row | undefined
      : undefined;
    const userMessage = conversationId
      ? db.prepare(`SELECT content FROM messages WHERE session_id=? AND role='user' AND created_at<=?
          ORDER BY created_at DESC,id DESC LIMIT 1`).get(conversationId, String(recommendation.createdAt ?? row.created_at)) as Row | undefined
      : undefined;
    const advisorMessage = conversationId && analysisId
      ? db.prepare(`SELECT content FROM messages WHERE session_id=? AND role='assistant' AND agent_run_id=?
          ORDER BY created_at DESC,id DESC LIMIT 1`).get(conversationId, analysisId) as Row | undefined
      : undefined;

    return {
      id: row.id,
      recommendationId,
      conversationId,
      analysisId,
      action: publicAction(row.action ?? row.decision),
      reason: payload.reason == null ? null : String(payload.reason),
      note: payload.note == null ? null : String(payload.note),
      recommendation,
      currentStatus: current?.status == null ? recommendation.status ?? null : current.status,
      currentUpdatedAt: current?.updated_at ?? null,
      conversationTitle: conversation?.title ?? null,
      userQuestion: userMessage?.content ?? null,
      advisorReply: advisorMessage?.content ?? null,
      instrument: instrument ? {
        symbol: instrument.symbol,
        name: instrument.name,
        market: instrument.market,
        assetType: instrument.asset_type,
      } : null,
      createdAt: row.created_at,
    };
  });
  db.close();
  return NextResponse.json({ data: { items }, meta: meta({ count: items.length }) });
}
