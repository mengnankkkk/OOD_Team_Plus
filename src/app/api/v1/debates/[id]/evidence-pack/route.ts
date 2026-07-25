import { NextRequest, NextResponse } from "next/server";

import { getSseEvents } from "@/server/extensions/sse/event-persister";
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
  const judgements = db.prepare("SELECT * FROM debate_judgements WHERE debate_session_id=? ORDER BY created_at,id").all(id) as Row[];
  const agentRuns = db.prepare("SELECT * FROM agent_runs WHERE user_id=? AND (id=? OR root_run_id=?) ORDER BY created_at,id")
    .all(userId, session.root_agent_run_id, session.root_agent_run_id) as Row[];
  const evidence = db.prepare(`SELECT ei.* FROM evidence_items ei JOIN agent_runs ar ON ar.id=ei.agent_run_id
    WHERE ei.user_id=? AND (ar.id=? OR ar.root_run_id=?) ORDER BY ei.created_at,ei.id`)
    .all(userId, session.root_agent_run_id, session.root_agent_run_id) as Row[];
  db.close();

  return NextResponse.json({
    data: {
      debateSessionId: id,
      motion: session.motion,
      status: String(session.status).toUpperCase(),
      rounds: rounds.map(formatRound),
      turns: turns.map(formatTurn),
      judgements: judgements.map(formatJudgement),
      agentTrace: agentRuns.map(formatAgentRun),
      evidence: evidence.map(formatEvidence),
      events: getSseEvents(String(session.root_agent_run_id)).map((event) => ({ id: event.id, type: event.type, payload: event.payload, createdAt: event.createdAt })),
      disclaimer: "多空 Battle 用于投资研究和方案模拟，不代表未来收益，不构成交易指令。",
    },
    meta: meta(),
  });
}

function formatRound(round: Row): Record<string, unknown> {
  return { id: round.id, roundIndex: round.round_index, roundFocus: round.round_focus, userIntent: round.user_intent, status: String(round.status).toUpperCase(), judgeSummary: parseJson(String(round.judge_summary_json ?? ""), null) };
}

function formatTurn(turn: Row): Record<string, unknown> {
  return { id: turn.id, roundId: turn.debate_round_id, speaker: turn.speaker, stance: turn.stance, turnType: turn.turn_type, content: turn.content, publicSummary: turn.public_summary, structuredPayload: parseJson(String(turn.structured_payload_json ?? "{}"), {}) };
}

function formatJudgement(item: Row): Record<string, unknown> {
  return {
    id: item.id,
    roundId: item.debate_round_id,
    userClaim: item.user_claim,
    bullStrongestPoint: item.bull_strongest_point,
    bearStrongestPoint: item.bear_strongest_point,
    keyDisagreement: item.key_disagreement,
    responseQuality: parseJson(String(item.response_quality_json), {}),
    evidenceTilt: item.evidence_tilt,
    confidence: Number(item.confidence_decimal),
    whyNotFinal: item.why_not_final,
    suggestedNextPrompts: parseJson(String(item.suggested_next_prompts_json), []),
    complianceNote: item.compliance_note,
  };
}

function formatAgentRun(run: Row): Record<string, unknown> {
  return { id: run.id, agent: run.agent_type ?? run.type, status: String(run.status).toUpperCase(), summary: run.output_summary ?? null, failure: run.failure_code ? { code: run.failure_code, message: run.failure_message } : null };
}

function formatEvidence(item: Row): Record<string, unknown> {
  return { id: item.id, kind: item.kind, stance: item.stance, title: item.title, summary: item.statement ?? item.summary, quality: item.quality };
}
