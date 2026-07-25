import { NextRequest, NextResponse } from "next/server";

import { getDatabase, getRequestContext, meta, parseJson } from "@/server/http/context";

type Row = Record<string, unknown>;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = getRequestContext(req);
  const db = getDatabase();
  const session = db.prepare("SELECT * FROM debate_sessions WHERE id=? AND user_id=?").get(id, userId) as Row | undefined;
  if (!session) {
    db.close();
    return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Debate not found" } }, { status: 404 });
  }
  const rounds = db.prepare("SELECT * FROM debate_rounds WHERE debate_session_id=? ORDER BY round_index").all(id) as Row[];
  const turns = db.prepare("SELECT * FROM debate_turns WHERE debate_session_id=? ORDER BY created_at,id").all(id) as Row[];
  db.close();
  return NextResponse.json({
    data: {
      ...session,
      status: String(session.status).toUpperCase(),
      rounds: rounds.map((round) => ({
        ...round,
        status: String(round.status).toUpperCase(),
        judgeSummary: parseJson(String(round.judge_summary_json ?? ""), null),
      })),
      turns: turns.map((turn) => ({
        ...turn,
        structuredPayload: parseJson(String(turn.structured_payload_json ?? "{}"), {}),
      })),
    },
    meta: meta(),
  });
}
