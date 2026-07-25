import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { seedAuthenticatedUser, TEST_USER_ID } from "@tests/helpers/auth";
import { getDatabase } from "@/server/http/context";

import { continueDebate, startDebate } from "./service";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-debate-service-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
  seedAuthenticatedUser();
  const db = getDatabase();
  db.prepare(`INSERT INTO conversation_sessions
    (id,user_id,title,status,created_at,updated_at,row_version)
    VALUES ('conversation_debate',?,'Battle','active','2026-07-25T00:00:00.000Z','2026-07-25T00:00:00.000Z',1)`).run(TEST_USER_ID);
  db.prepare(`INSERT INTO instruments
    (id,symbol,name,market,asset_type,tradable)
    VALUES ('instrument_510300','510300.OF','沪深300ETF','OF','ETF',1)`).run();
  db.close();
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
});

describe("debate service", () => {
  it("starts a debate with user, evidence, bull, bear, and judge turns", async () => {
    const result = await startDebate({
      userId: TEST_USER_ID,
      conversationId: "conversation_debate",
      message: "我现在要不要加仓 510300？",
      targetSymbol: "510300.OF",
      initialUserRole: "neutral",
      runners: runnersFor(["evidence", "bull", "bear", "judge"], "neutral"),
      evidenceCall: async () => evidenceBoard(),
    });

    expect(result.debateSessionId).toMatch(/^debate_/u);
    expect(result.analysis.analysisId).toMatch(/^analysis_/u);
    expect(result.analysis.streamUrl).toBe(`/api/v1/debates/${result.debateSessionId}/events`);

    const db = getDatabase();
    const turns = db.prepare(`SELECT speaker,stance,turn_type FROM debate_turns
      WHERE debate_session_id=? ORDER BY created_at,id`).all(result.debateSessionId) as TurnRow[];
    const argumentsCount = db.prepare("SELECT COUNT(*) AS count FROM debate_arguments").get() as { count: number };
    const judgement = db.prepare("SELECT evidence_tilt FROM debate_judgements WHERE debate_session_id=?").get(result.debateSessionId) as { evidence_tilt?: string };
    const events = db.prepare("SELECT event_type FROM agent_run_events WHERE root_run_id=? ORDER BY sequence_no").all(result.analysis.analysisId) as Array<{ event_type: string }>;
    db.close();

    expect(turns.map((turn) => turn.speaker)).toEqual(["user", "evidence", "bull", "bear", "judge"]);
    expect(turns.map((turn) => turn.turn_type)).toEqual(["support", "evidence_update", "opening", "rebuttal", "judge_summary"]);
    expect(argumentsCount.count).toBe(2);
    expect(judgement.evidence_tilt).toBe("balanced");
    expect(events.map((event) => event.event_type)).toContain("debate.round.completed");
  });

  it("continues a debate with a user-supported bull rebuttal round", async () => {
    const started = await startDebate({
      userId: TEST_USER_ID,
      conversationId: "conversation_debate",
      message: "是否加仓 510300？",
      targetSymbol: "510300.OF",
      initialUserRole: "neutral",
      runners: runnersFor(["evidence", "bull", "bear", "judge"], "neutral"),
      evidenceCall: async () => evidenceBoard(),
    });
    const continued = await continueDebate({
      userId: TEST_USER_ID,
      debateSessionId: started.debateSessionId,
      content: "我站多方，跌多了可能便宜。",
      userRole: "bull",
      runners: runnersFor(["evidence", "bull", "bear", "bull", "judge"], "bull"),
      evidenceCall: async (input) => evidenceBoard(input.userClaims),
    });

    expect(continued.roundIndex).toBe(2);
    expect(continued.judgement.userClaim).toContain("用户询问");

    const db = getDatabase();
    const turns = db.prepare(`SELECT speaker,stance,turn_type,structured_payload_json FROM debate_turns
      WHERE debate_round_id=? ORDER BY created_at,id`).all(continued.roundId) as TurnRow[];
    const session = db.prepare("SELECT current_round_index,user_debate_role FROM debate_sessions WHERE id=?").get(started.debateSessionId) as { current_round_index?: number; user_debate_role?: string };
    db.close();

    expect(turns.map((turn) => `${turn.speaker}:${turn.turn_type}`)).toEqual([
      "user:support",
      "evidence:evidence_update",
      "bull:support",
      "bear:rebuttal",
      "bull:answer",
      "judge:judge_summary",
    ]);
    expect(JSON.parse(String(turns[1]?.structured_payload_json)).board.userClaims).toEqual(["我站多方，跌多了可能便宜。"]);
    expect(session).toEqual({ current_round_index: 2, user_debate_role: "bull" });
  });
});

type TurnRow = {
  speaker: string;
  stance: string;
  turn_type: string;
  structured_payload_json?: string;
};

function runnersFor(speakingOrder: Array<"evidence" | "bull" | "bear" | "judge">, userDebateRole: "neutral" | "bull" | "bear") {
  return {
    plan: vi.fn(async () => ({
      userDebateRole,
      userIntent: userDebateRole === "bull" ? "support_bull" as const : "ask_both" as const,
      motion: "未来 1-3 个月是否应加仓 510300",
      roundFocus: "跌幅是否代表便宜",
      requiredAgents: [...new Set(speakingOrder)] as Array<"evidence" | "bull" | "bear" | "judge">,
      speakingOrder,
      needsFreshData: false,
      reasonForFocus: "用户需要理解跌幅和便宜不是一回事。",
    })),
    advocate: vi.fn(async (stance: "bull" | "bear") => ({
      stance,
      headline: stance === "bull" ? "估值修复值得验证" : "趋势风险仍需警惕",
      directResponseToUser: "我会用证据回应你的观点。",
      arguments: [{
        stance,
        claim: `${stance} 核心观点`,
        plainLanguage: "白话观点",
        evidenceRefs: [],
        counterEvidenceRefs: [],
        assumption: "关键假设",
        confidence: 0.5,
        vulnerability: "关键漏洞",
      }],
      strongestAttackOnOpponent: "对方需要补充证据。",
      admittedWeakness: "本方也缺一项关键证据。",
      questionForOpponent: "你的关键证据是什么？",
      plainLanguageSummary: `${stance} 只是研究观点。`,
      suggestedUserFollowUp: "继续追问关键证据。",
    })),
    judge: vi.fn(async () => ({
      userClaim: "用户询问是否加仓。",
      bullStrongestPoint: "多方提出估值修复。",
      bearStrongestPoint: "空方提出趋势风险。",
      keyDisagreement: "估值是否足够便宜。",
      responseQuality: { bull: "direct" as const, bear: "direct" as const },
      evidenceTilt: "balanced" as const,
      confidence: 0.55,
      whyNotFinal: "缺少更多证据。",
      suggestedNextPrompts: ["让多方解释估值是否真的便宜"],
      complianceNote: "仅用于研究和模拟。",
    })),
  };
}

function evidenceBoard(userClaims: string[] = []) {
  return {
    debateSessionId: "debate_mock",
    rootAgentRunId: "analysis_mock",
    motion: "是否加仓 510300",
    targetSymbol: "510300.OF",
    profileFacts: ["风险等级：BALANCED"],
    portfolioFacts: ["510300.OF 沪深300ETF，权重 280bps，浮盈亏 -20"],
    marketFacts: [],
    userClaims,
    missingData: [],
    pandaExecutions: [],
  };
}
