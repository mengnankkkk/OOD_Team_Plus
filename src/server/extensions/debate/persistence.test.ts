import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDatabase, isoNow } from "@/server/http/context";
import { seedAuthenticatedUser, TEST_USER_ID } from "@tests/helpers/auth";

import { createDebateArgument, createDebateJudgement, createDebateRound, createDebateSession, createDebateTurn } from "./persistence";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-debate-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
  seedAuthenticatedUser();
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
});

describe("debate persistence", () => {
  it("persists session, round, turn, and judgement records", () => {
    const db = getDatabase();
    const now = isoNow();
    db.prepare(`INSERT INTO conversation_sessions
      (id,user_id,title,status,created_at,updated_at,row_version)
      VALUES ('conversation_debate',?,'Battle','active',?,?,1)`).run(TEST_USER_ID, now, now);
    db.prepare(`INSERT INTO agent_runs
      (id,user_id,type,status,session_id,created_at)
      VALUES ('analysis_debate',?,'debate_agent','running','conversation_debate',?)`).run(TEST_USER_ID, now);

    const sessionId = createDebateSession(db, {
      userId: TEST_USER_ID,
      conversationId: "conversation_debate",
      rootAgentRunId: "analysis_debate",
      motion: "Should the investor add to the position?",
      targetSymbol: "AAPL",
      userDebateRole: "neutral",
    });
    const roundId = createDebateRound(db, {
      debateSessionId: sessionId,
      roundIndex: 1,
      roundFocus: "Test the valuation case against execution risk.",
      userIntent: "ask_both",
    });
    const turnId = createDebateTurn(db, {
      debateSessionId: sessionId,
      debateRoundId: roundId,
      speaker: "bull",
      stance: "bull",
      turnType: "opening",
      content: "The bull case has durable demand support.",
      publicSummary: "The bull case emphasizes durable demand.",
      structuredPayload: { headline: "Durable demand" },
    });
    const argumentId = createDebateArgument(db, {
      debateTurnId: turnId,
      stance: "bull",
      claim: "Demand remains resilient.",
      plainLanguage: "Customers are still buying.",
      evidenceRefs: ["evidence-demand"],
      counterEvidenceRefs: ["evidence-slowdown"],
      assumption: "Demand remains broad.",
      confidence: 0.72,
      vulnerability: "Demand may weaken in a recession.",
    });
    createDebateJudgement(db, {
      debateSessionId: sessionId,
      debateRoundId: roundId,
      userClaim: "The investor wants to know whether the decline creates an entry point.",
      bullStrongestPoint: "Demand may support a valuation recovery.",
      bearStrongestPoint: "A decline alone does not establish value.",
      keyDisagreement: "Whether the current valuation is genuinely attractive.",
      responseQuality: { bull: "direct", bear: "direct" },
      evidenceTilt: "balanced",
      confidence: 0.55,
      whyNotFinal: "The valuation percentile is still missing.",
      suggestedNextPrompts: ["Compare the current multiple with its historical range."],
      complianceNote: "For research and simulation only.",
    });

    const savedTurn = db.prepare("SELECT * FROM debate_turns WHERE id=?").get(turnId) as Record<string, unknown> | undefined;
    const savedArgument = db.prepare("SELECT * FROM debate_arguments WHERE id=?").get(argumentId) as Record<string, unknown> | undefined;
    const savedJudgement = db.prepare("SELECT * FROM debate_judgements WHERE debate_round_id=?").get(roundId) as Record<string, unknown> | undefined;
    const savedRound = db.prepare("SELECT status FROM debate_rounds WHERE id=?").get(roundId) as { status?: string } | undefined;
    const savedSession = db.prepare("SELECT current_round_index FROM debate_sessions WHERE id=?").get(sessionId) as { current_round_index?: number } | undefined;
    db.close();

    expect(savedTurn?.speaker).toBe("bull");
    expect(JSON.parse(String(savedTurn?.structured_payload_json))).toEqual({ headline: "Durable demand" });
    expect(savedArgument).toMatchObject({
      stance: "bull",
      claim: "Demand remains resilient.",
      plain_language: "Customers are still buying.",
      assumption: "Demand remains broad.",
      confidence_decimal: "0.72",
      vulnerability: "Demand may weaken in a recession.",
    });
    expect(JSON.parse(String(savedArgument?.evidence_refs_json))).toEqual(["evidence-demand"]);
    expect(JSON.parse(String(savedArgument?.counter_evidence_refs_json))).toEqual(["evidence-slowdown"]);
    expect(savedJudgement?.evidence_tilt).toBe("balanced");
    expect(savedRound?.status).toBe("completed");
    expect(savedSession?.current_round_index).toBe(1);
  });

  it("rejects turns and judgements whose session does not own the round", () => {
    const db = getDatabase();
    const now = isoNow();
    db.prepare(`INSERT INTO conversation_sessions
      (id,user_id,title,status,created_at,updated_at,row_version)
      VALUES ('conversation_debate_a',?,'Battle A','active',?,?,1),
             ('conversation_debate_b',?,'Battle B','active',?,?,1)`).run(TEST_USER_ID, now, now, TEST_USER_ID, now, now);
    db.prepare(`INSERT INTO agent_runs
      (id,user_id,type,status,session_id,created_at)
      VALUES ('analysis_debate_a',?,'debate_agent','running','conversation_debate_a',?),
             ('analysis_debate_b',?,'debate_agent','running','conversation_debate_b',?)`).run(TEST_USER_ID, now, TEST_USER_ID, now);

    const sessionA = createDebateSession(db, {
      userId: TEST_USER_ID,
      conversationId: "conversation_debate_a",
      rootAgentRunId: "analysis_debate_a",
      motion: "Session A motion",
      userDebateRole: "neutral",
    });
    const sessionB = createDebateSession(db, {
      userId: TEST_USER_ID,
      conversationId: "conversation_debate_b",
      rootAgentRunId: "analysis_debate_b",
      motion: "Session B motion",
      userDebateRole: "neutral",
    });
    const roundB = createDebateRound(db, {
      debateSessionId: sessionB,
      roundIndex: 1,
      roundFocus: "Session B focus",
      userIntent: "ask_both",
    });

    expect(() => createDebateTurn(db, {
      debateSessionId: sessionA,
      debateRoundId: roundB,
      speaker: "bull",
      stance: "bull",
      turnType: "opening",
      content: "This turn has a mismatched round.",
      publicSummary: "Mismatched turn.",
      structuredPayload: {},
    })).toThrow(/FOREIGN KEY constraint failed/u);
    expect(() => createDebateJudgement(db, {
      debateSessionId: sessionA,
      debateRoundId: roundB,
      userClaim: "Mismatched judgement.",
      bullStrongestPoint: "Bull point.",
      bearStrongestPoint: "Bear point.",
      keyDisagreement: "The session and round do not match.",
      responseQuality: { bull: "direct", bear: "direct" },
      evidenceTilt: "balanced",
      confidence: 0.5,
      whyNotFinal: "The relationship is invalid.",
      suggestedNextPrompts: ["Use a round from the same session."],
      complianceNote: "For research only.",
    })).toThrow(/FOREIGN KEY constraint failed/u);
    db.close();
  });
});
