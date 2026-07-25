import { createId, isoNow, json } from "@/server/http/context";
import type { SqliteDb } from "@/server/db/client.runtime";

import type { DebateJudgement, DebateTurn, DebateUserIntent, DebateUserRole } from "./contracts";

export function createDebateSession(db: SqliteDb, input: {
  userId: string;
  conversationId: string;
  rootAgentRunId: string;
  motion: string;
  targetInstrumentId?: string | null;
  targetSymbol?: string | null;
  userDebateRole: DebateUserRole;
}): string {
  const now = isoNow();
  const id = createId("debate");
  db.prepare(`INSERT INTO debate_sessions
    (id,user_id,conversation_id,root_agent_run_id,motion,target_instrument_id,target_symbol,user_debate_role,status,current_round_index,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?, 'active',0,?,?)`).run(
    id,
    input.userId,
    input.conversationId,
    input.rootAgentRunId,
    input.motion,
    input.targetInstrumentId ?? null,
    input.targetSymbol ?? null,
    input.userDebateRole,
    now,
    now,
  );
  return id;
}

export function createDebateRound(db: SqliteDb, input: {
  debateSessionId: string;
  roundIndex: number;
  roundFocus: string;
  userIntent: DebateUserIntent;
}): string {
  const now = isoNow();
  const id = createId("debate_round");
  db.prepare(`INSERT INTO debate_rounds
    (id,debate_session_id,round_index,round_focus,user_intent,status,created_at)
    VALUES (?,?,?,?,?,'running',?)`).run(id, input.debateSessionId, input.roundIndex, input.roundFocus, input.userIntent, now);
  db.prepare("UPDATE debate_sessions SET current_round_index=?,updated_at=? WHERE id=?")
    .run(input.roundIndex, now, input.debateSessionId);
  return id;
}

export function createDebateTurn(db: SqliteDb, input: DebateTurn & { debateSessionId: string; debateRoundId: string }): string {
  const id = createId("debate_turn");
  const now = isoNow();
  db.prepare(`INSERT INTO debate_turns
    (id,debate_session_id,debate_round_id,speaker,stance,turn_type,content,public_summary,structured_payload_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    input.debateSessionId,
    input.debateRoundId,
    input.speaker,
    input.stance,
    input.turnType,
    input.content,
    input.publicSummary,
    json(input.structuredPayload),
    now,
  );
  return id;
}

export function createDebateJudgement(db: SqliteDb, input: DebateJudgement & { debateSessionId: string; debateRoundId: string }): string {
  const id = createId("debate_judgement");
  const now = isoNow();
  db.prepare(`INSERT INTO debate_judgements
    (id,debate_session_id,debate_round_id,user_claim,bull_strongest_point,bear_strongest_point,key_disagreement,response_quality_json,evidence_tilt,confidence_decimal,why_not_final,suggested_next_prompts_json,compliance_note,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    input.debateSessionId,
    input.debateRoundId,
    input.userClaim,
    input.bullStrongestPoint,
    input.bearStrongestPoint,
    input.keyDisagreement,
    json(input.responseQuality),
    input.evidenceTilt,
    String(input.confidence),
    input.whyNotFinal,
    json(input.suggestedNextPrompts),
    input.complianceNote,
    now,
  );
  db.prepare("UPDATE debate_rounds SET status='completed',judge_summary_json=?,completed_at=? WHERE id=?")
    .run(json(input), now, input.debateRoundId);
  return id;
}
