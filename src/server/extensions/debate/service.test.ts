/* eslint-disable max-lines */
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { seedAuthenticatedUser, TEST_USER_ID } from "@tests/helpers/auth";
import { getDatabase } from "@/server/http/context";

import type { AdvisorPublicationResult } from "@/server/extensions/advisor/service";
import type { DebateRoundPlan } from "./contracts";
import { buildDebateEvidenceBoard } from "./evidence";
import {
  buildDebateChiefAdvisorPrompt,
  continueDebate,
  continueDebateInBackground,
  DebateSessionError,
  startDebate,
  startDebateInBackground,
  type DebateRunners,
} from "./service";

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
  it("builds a publication-gate handoff prompt", () => {
    const prompt = buildDebateChiefAdvisorPrompt({
      motion: "是否加仓 510300",
      turns: [{ speaker: "bull", publicSummary: "多方认为估值修复值得验证" }],
      judgements: [{
        userClaim: "用户想加仓",
        bullStrongestPoint: "估值修复",
        bearStrongestPoint: "趋势风险",
        keyDisagreement: "估值是否便宜",
        responseQuality: { bull: "direct", bear: "direct" },
        evidenceTilt: "balanced",
        confidence: 0.55,
        whyNotFinal: "缺证据",
        suggestedNextPrompts: ["继续追问"],
        complianceNote: "仅研究",
      }],
    });

    expect(prompt).toContain("不得将任一方胜负直接变成交易指令");
  });

  it("starts a debate with user, evidence, bull, bear, and judge turns", async () => {
    let planPrompt = "";
    const baseRunners = runnersFor(["evidence", "bull", "bear", "judge"], "neutral");
    const publish = vi.fn<NonNullable<DebateRunners["publish"]>>();
    const result = await startDebate({
      userId: TEST_USER_ID,
      conversationId: "conversation_debate",
      message: "我现在要不要加仓 510300？",
      targetSymbol: "510300.OF",
      initialUserRole: "neutral",
      runners: {
        ...baseRunners,
        plan: vi.fn(async (prompt: string) => {
          planPrompt = prompt;
          return baseRunners.plan();
        }),
        publish,
      },
      evidenceCall: async () => evidenceBoard(),
    });

    expect(result.debateSessionId).toMatch(/^debate_/u);
    expect(result.analysis.analysisId).toMatch(/^analysis_/u);
    expect(result.analysis.streamUrl).toBe(`/api/v1/debates/${result.debateSessionId}/events`);

    const db = getDatabase();
    const turns = db.prepare(`SELECT speaker,stance,turn_type FROM debate_turns
      WHERE debate_session_id=? ORDER BY created_at,id`).all(result.debateSessionId) as TurnRow[];
    const messages = db.prepare("SELECT role,content,metadata_json FROM messages WHERE session_id='conversation_debate' ORDER BY created_at,id").all() as Array<{ role: string; content: string; metadata_json: string }>;
    const argumentsCount = db.prepare("SELECT COUNT(*) AS count FROM debate_arguments").get() as { count: number };
    const judgement = db.prepare("SELECT evidence_tilt FROM debate_judgements WHERE debate_session_id=?").get(result.debateSessionId) as { evidence_tilt?: string };
    const events = db.prepare("SELECT event_type,payload_json FROM agent_run_events WHERE root_run_id=? ORDER BY sequence_no").all(result.analysis.analysisId) as Array<{ event_type: string; payload_json: string }>;
    db.close();

    expect(turns.map((turn) => turn.speaker)).toEqual(["user", "evidence", "bull", "bear", "bull", "bear", "judge"]);
    expect(turns.map((turn) => turn.turn_type)).toEqual(["support", "evidence_update", "opening", "rebuttal", "answer", "answer", "judge_summary"]);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(JSON.parse(messages[1].metadata_json)).toMatchObject({
      debateSessionId: result.debateSessionId,
      roundIndex: 1,
      debateMotion: "未来 1-3 个月是否应加仓 510300",
    });
    expect(argumentsCount.count).toBe(4);
    expect(judgement.evidence_tilt).toBe("balanced");
    expect(events.map((event) => event.event_type)).toContain("debate.round.completed");
    expect(JSON.parse(events.find((event) => event.event_type === "debate.round.completed")!.payload_json).roundIndex).toBe(1);
    expect(planPrompt).toContain("evidenceBoard");
    expect(planPrompt).toContain("风险等级");
    expect(publish).not.toHaveBeenCalled();
  });

  it("gives both advocates a rebuttal after they have seen the opponent", async () => {
    const baseRunners = runnersFor(["evidence", "bull", "bear", "judge"], "neutral");
    const prompts: Array<{ stance: "bull" | "bear"; prompt: string }> = [];

    await startDebate({
      userId: TEST_USER_ID,
      conversationId: "conversation_debate",
      message: "是否加仓 510300？",
      targetSymbol: "510300.OF",
      runners: {
        ...baseRunners,
        advocate: vi.fn(async (stance: "bull" | "bear", prompt: string) => {
          prompts.push({ stance, prompt });
          return baseRunners.advocate(stance);
        }),
      },
      evidenceCall: async () => evidenceBoard(),
    });

    const bullPrompts = prompts.filter((item) => item.stance === "bull");
    const bearPrompts = prompts.filter((item) => item.stance === "bear");
    expect(bullPrompts).toHaveLength(2);
    expect(bearPrompts).toHaveLength(2);
    expect(JSON.parse(bullPrompts[1]!.prompt).priorPublicSpeeches)
      .toEqual(expect.arrayContaining([expect.objectContaining({ stance: "bear" })]));
    expect(JSON.parse(bearPrompts[1]!.prompt).priorPublicSpeeches)
      .toEqual(expect.arrayContaining([expect.objectContaining({ stance: "bull" })]));
  });

  it.each([
    ["neutral", "bull"],
    ["bull", "bear"],
    ["bear", "neutral"],
  ] as const)("uses the explicit %s role in every downstream plan when the Orchestrator infers %s", async (explicitRole, inferredRole) => {
    let planPrompt = "";
    const downstreamPrompts: string[] = [];
    const baseRunners = runnersFor(["evidence", "bull", "bear", "judge"], inferredRole);
    const result = await startDebate({
      userId: TEST_USER_ID,
      conversationId: "conversation_debate",
      message: "请按我在界面选择的角色继续讨论。",
      initialUserRole: explicitRole,
      runners: {
        ...baseRunners,
        plan: vi.fn(async (prompt: string) => {
          planPrompt = prompt;
          return baseRunners.plan();
        }),
        advocate: vi.fn(async (stance: "bull" | "bear", prompt: string) => {
          downstreamPrompts.push(prompt);
          return baseRunners.advocate(stance);
        }),
        judge: vi.fn(async (prompt: string) => {
          downstreamPrompts.push(prompt);
          return baseRunners.judge();
        }),
      },
      evidenceCall: async () => evidenceBoard(),
    });

    const db = getDatabase();
    const userTurn = db.prepare("SELECT stance FROM debate_turns WHERE debate_round_id=? AND speaker='user'")
      .get(result.roundId) as { stance?: string };
    const session = db.prepare("SELECT user_debate_role FROM debate_sessions WHERE id=?")
      .get(result.debateSessionId) as { user_debate_role?: string };
    db.close();

    expect(JSON.parse(planPrompt).userRole).toBe(explicitRole);
    expect(downstreamPrompts).toHaveLength(5);
    for (const prompt of downstreamPrompts) {
      expect(JSON.parse(prompt).plan.userDebateRole).toBe(explicitRole);
    }
    expect(userTurn.stance).toBe(explicitRole);
    expect(session.user_debate_role).toBe(explicitRole);
  });

  it("returns a running stream handle before the opening round finishes", async () => {
    const gate = deferred<void>();
    const baseRunners = runnersFor(["evidence", "bull", "bear", "judge"], "neutral");
    const plan = vi.fn(async () => {
      await gate.promise;
      return baseRunners.plan();
    });

    const started = startDebateInBackground({
      userId: TEST_USER_ID,
      conversationId: "conversation_debate",
      message: "是否加仓 510300？",
      targetSymbol: "510300.OF",
      runners: { ...baseRunners, plan },
      evidenceCall: async () => evidenceBoard(),
    });

    expect(started.analysis.status).toBe("RUNNING");
    expect(started.analysis.streamUrl).toMatch(new RegExp(`/api/v1/debates/${started.debateSessionId}/events\\?after=event_`, "u"));
    await vi.waitFor(() => expect(plan).toHaveBeenCalledOnce());
    expect(rootRunStatus(started.analysis.analysisId)).toBe("running");

    gate.resolve();
    await vi.waitFor(() => expect(rootRunStatus(started.analysis.analysisId)).toBe("completed"));
  }, 15_000);

  it("can defer the opening round to a request-lifecycle scheduler", async () => {
    const baseRunners = runnersFor(["evidence", "bull", "bear", "judge"], "neutral");
    const plan = vi.fn(baseRunners.plan);
    let scheduledTask: (() => Promise<unknown>) | undefined;

    const started = startDebateInBackground({
      userId: TEST_USER_ID,
      conversationId: "conversation_debate",
      message: "是否加仓 510300？",
      targetSymbol: "510300.OF",
      runners: { ...baseRunners, plan },
      evidenceCall: async () => evidenceBoard(),
    }, (task) => {
      scheduledTask = task;
    });

    expect(started.analysis.status).toBe("RUNNING");
    expect(plan).not.toHaveBeenCalled();
    expect(rootRunStatus(started.analysis.analysisId)).toBe("running");

    await scheduledTask?.();

    expect(plan).toHaveBeenCalledOnce();
    expect(rootRunStatus(started.analysis.analysisId)).toBe("completed");
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
      "bear:answer",
      "judge:judge_summary",
    ]);
    expect(JSON.parse(String(turns[1]?.structured_payload_json)).board.userClaims).toEqual(["我站多方，跌多了可能便宜。"]);
    expect(session).toEqual({ current_round_index: 2, user_debate_role: "bull" });
  });

  it("returns a running handle for the next round and rejects a concurrent continuation", async () => {
    const started = await startDebate({
      userId: TEST_USER_ID,
      conversationId: "conversation_debate",
      message: "是否加仓 510300？",
      targetSymbol: "510300.OF",
      runners: runnersFor(["evidence", "bull", "bear", "judge"], "neutral"),
      evidenceCall: async () => evidenceBoard(),
    });
    const gate = deferred<void>();
    const baseRunners = runnersFor(["evidence", "bull", "bear", "judge"], "bull");
    const plan = vi.fn(async () => {
      await gate.promise;
      return baseRunners.plan();
    });

    const continued = continueDebateInBackground({
      userId: TEST_USER_ID,
      debateSessionId: started.debateSessionId,
      content: "我站多方，请继续。",
      userRole: "bull",
      runners: { ...baseRunners, plan },
      evidenceCall: async () => evidenceBoard(),
    });

    expect(continued.analysis.status).toBe("RUNNING");
    expect(continued.analysis.streamUrl).toMatch(new RegExp(`/api/v1/debates/${started.debateSessionId}/events\\?after=event_`, "u"));
    await vi.waitFor(() => expect(plan).toHaveBeenCalledOnce());
    expect(conversationMessageCount(started.debateSessionId, "user")).toBe(2);
    expect(() => continueDebateInBackground({
      userId: TEST_USER_ID,
      debateSessionId: started.debateSessionId,
      content: "重复续轮",
      userRole: "bull",
      runners: baseRunners,
      evidenceCall: async () => evidenceBoard(),
    })).toThrow("RUN_ALREADY_ACTIVE");

    gate.resolve();
    await vi.waitFor(() => expect(rootRunStatus(started.analysis.analysisId)).toBe("completed"));
  }, 15_000);

  it("distinguishes a blocked session from a missing session without adding another user turn", async () => {
    const started = await startDebate({
      userId: TEST_USER_ID,
      conversationId: "conversation_debate",
      message: "是否加仓 510300？",
      targetSymbol: "510300.OF",
      runners: runnersFor(["evidence", "bull", "bear", "judge"], "neutral"),
      evidenceCall: async () => evidenceBoard(),
    });
    const before = conversationMessageCount(started.debateSessionId, "user");
    const db = getDatabase();
    db.prepare("UPDATE debate_sessions SET status='blocked' WHERE id=?").run(started.debateSessionId);
    db.close();

    let blockedError: unknown;
    try {
      continueDebateInBackground({
        userId: TEST_USER_ID,
        debateSessionId: started.debateSessionId,
        content: "请继续。",
        userRole: "neutral",
        runners: runnersFor(["evidence", "bull", "bear", "judge"], "neutral"),
        evidenceCall: async () => evidenceBoard(),
      });
    } catch (error) {
      blockedError = error;
    }
    expect(blockedError).toBeInstanceOf(DebateSessionError);
    expect(blockedError).toMatchObject({
      code: "DEBATE_BLOCKED",
      message: "Debate is blocked; start a new Battle",
    });
    expect(conversationMessageCount(started.debateSessionId, "user")).toBe(before);

    let missingError: unknown;
    try {
      continueDebateInBackground({
        userId: TEST_USER_ID,
        debateSessionId: "debate_missing",
        content: "请继续。",
        userRole: "neutral",
        runners: runnersFor(["evidence", "bull", "bear", "judge"], "neutral"),
        evidenceCall: async () => evidenceBoard(),
      });
    } catch (error) {
      missingError = error;
    }
    expect(missingError).toBeInstanceOf(DebateSessionError);
    expect(missingError).toMatchObject({
      code: "DEBATE_NOT_FOUND",
      message: "Debate not found",
    });
  });

  it("hands an action-request round to the Chief Advisor publication gate", async () => {
    const baseRunners = runnersFor(["evidence", "bull", "bear", "judge"], "neutral");
    const publishInputs: Array<Parameters<NonNullable<DebateRunners["publish"]>>[0]> = [];
    const publish = vi.fn(async (input: Parameters<NonNullable<DebateRunners["publish"]>>[0]): Promise<AdvisorPublicationResult> => {
      publishInputs.push(input);
      return {
      analysisId: "analysis_publication",
      status: "DEGRADED" as const,
      direction: "HOLD" as const,
      action: "WATCH" as const,
      answer: "发布门结论：当前只适合观察。",
      recommendationId: null,
      missingInformation: [],
      provider: "CHIEF_ADVISOR" as const,
      };
    });
    const result = await startDebate({
      userId: TEST_USER_ID,
      conversationId: "conversation_debate",
      message: "辩论完以后给我一个保守模拟方案。",
      targetSymbol: "510300.OF",
      runners: {
        ...baseRunners,
        plan: vi.fn(async (): Promise<DebateRoundPlan> => {
          const plan = await baseRunners.plan();
          return { ...plan, requiredAgents: [...plan.requiredAgents, "chief_advisor"] };
        }),
        publish,
      },
      evidenceCall: async () => evidenceBoard(),
    });

    expect(publish).toHaveBeenCalledOnce();
    expect(publishInputs[0]?.content).toContain("不得将任一方胜负直接变成交易指令");
    expect(result.publication).toMatchObject({ status: "DEGRADED", action: "WATCH" });

    const db = getDatabase();
    const assistant = db.prepare("SELECT metadata_json FROM messages WHERE session_id='conversation_debate' AND role='assistant'").get() as { metadata_json: string };
    db.close();
    expect(JSON.parse(assistant.metadata_json).publication).toMatchObject({ status: "DEGRADED", action: "WATCH" });
  });

  it("keeps the round running until the assistant result is ready", async () => {
    const gate = deferred<AdvisorPublicationResult>();
    const baseRunners = runnersFor(["evidence", "bull", "bear", "judge"], "neutral");
    const publish = vi.fn(async () => gate.promise);
    const started = startDebateInBackground({
      userId: TEST_USER_ID,
      conversationId: "conversation_debate",
      message: "辩论后给我一个模拟方案。",
      targetSymbol: "510300.OF",
      runners: {
        ...baseRunners,
        plan: vi.fn(async (): Promise<DebateRoundPlan> => {
          const plan = await baseRunners.plan();
          return { ...plan, requiredAgents: [...plan.requiredAgents, "chief_advisor"] };
        }),
        publish,
      },
      evidenceCall: async () => evidenceBoard(),
    });

    await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce());
    expect(latestRoundStatus(started.debateSessionId)).toBe("running");
    expect(conversationMessageCount(started.debateSessionId, "assistant")).toBe(0);

    gate.resolve({
      analysisId: "analysis_publication",
      status: "DEGRADED",
      direction: "HOLD",
      action: "WATCH",
      answer: "发布门结论：继续观察。",
      recommendationId: null,
      missingInformation: [],
      provider: "CHIEF_ADVISOR",
    });

    await vi.waitFor(() => expect(rootRunStatus(started.analysis.analysisId)).toBe("completed"));
    expect(latestRoundStatus(started.debateSessionId)).toBe("completed");
    expect(conversationMessageCount(started.debateSessionId, "assistant")).toBe(1);
  }, 15_000);

  it("persists a blocked assistant result when a round fails", async () => {
    const baseRunners = runnersFor(["evidence", "bull", "bear", "judge"], "neutral");

    await expect(startDebate({
      userId: TEST_USER_ID,
      conversationId: "conversation_debate",
      message: "是否加仓 510300？",
      targetSymbol: "510300.OF",
      runners: {
        ...baseRunners,
        advocate: vi.fn(async () => {
          throw new Error("advocate unavailable");
        }),
      },
      evidenceCall: async () => evidenceBoard(),
    })).rejects.toThrow("advocate unavailable");

    const db = getDatabase();
    const assistant = db.prepare(`SELECT content,metadata_json FROM messages
      WHERE session_id='conversation_debate' AND role='assistant'`).get() as { content?: string; metadata_json?: string } | undefined;
    const session = db.prepare("SELECT status FROM debate_sessions ORDER BY created_at DESC LIMIT 1").get() as { status?: string } | undefined;
    db.close();

    expect(session?.status).toBe("blocked");
    expect(assistant?.content).toContain("advocate unavailable");
    expect(JSON.parse(String(assistant?.metadata_json))).toMatchObject({
      outputMode: "BATTLE",
      roundIndex: 1,
      status: "BLOCKED",
    });
  });

  it("refreshes the shared evidence board when the Orchestrator requests fresh data", async () => {
    const baseRunners = runnersFor(["evidence", "bull", "bear", "judge"], "neutral");
    const evidenceInputs: Array<Parameters<typeof buildDebateEvidenceBoard>[0]> = [];
    const evidenceCall = vi.fn(async (input: Parameters<typeof buildDebateEvidenceBoard>[0]) => {
      evidenceInputs.push(input);
      return evidenceBoard();
    });

    await startDebate({
      userId: TEST_USER_ID,
      conversationId: "conversation_debate",
      message: "请用最新证据再辩一轮。",
      targetSymbol: "510300.OF",
      runners: {
        ...baseRunners,
        plan: vi.fn(async (): Promise<DebateRoundPlan> => ({
          ...await baseRunners.plan(),
          needsFreshData: true,
        })),
      },
      evidenceCall,
    });

    expect(evidenceCall).toHaveBeenCalledTimes(2);
    expect(evidenceInputs[1]?.motion).toBe("未来 1-3 个月是否应加仓 510300");
  });
});

type TurnRow = {
  speaker: string;
  stance: string;
  turn_type: string;
  structured_payload_json?: string;
};

function runnersFor(speakingOrder: Array<"evidence" | "bull" | "bear" | "judge">, userDebateRole: "neutral" | "bull" | "bear") {
  const advocates = [...new Set(speakingOrder.filter((agent): agent is "bull" | "bear" => agent === "bull" || agent === "bear"))];
  if (!advocates.includes("bull")) advocates.push("bull");
  if (!advocates.includes("bear")) advocates.push("bear");
  const requiredAgents: DebateRoundPlan["requiredAgents"] = ["evidence", "bull", "bear", "judge"];
  const balancedSpeakingOrder: Array<"evidence" | "bull" | "bear" | "judge"> = [
    "evidence",
    ...advocates,
    ...advocates,
    "judge",
  ];
  return {
    plan: vi.fn(async () => ({
      userDebateRole,
      userIntent: userDebateRole === "bull" ? "support_bull" as const : "ask_both" as const,
      motion: "未来 1-3 个月是否应加仓 510300",
      roundFocus: "跌幅是否代表便宜",
      requiredAgents,
      speakingOrder: balancedSpeakingOrder,
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function rootRunStatus(analysisId: string): string | null {
  const db = getDatabase();
  const row = db.prepare("SELECT status FROM agent_runs WHERE id=?").get(analysisId) as { status?: string } | undefined;
  db.close();
  return row?.status ?? null;
}

function conversationMessageCount(debateSessionId: string, role: "user" | "assistant"): number {
  const db = getDatabase();
  const row = db.prepare(`SELECT COUNT(*) AS count FROM messages
    WHERE role=? AND session_id=(SELECT conversation_id FROM debate_sessions WHERE id=?)`)
    .get(role, debateSessionId) as { count: number };
  db.close();
  return row.count;
}

function latestRoundStatus(debateSessionId: string): string | null {
  const db = getDatabase();
  const row = db.prepare(`SELECT status FROM debate_rounds
    WHERE debate_session_id=? ORDER BY round_index DESC LIMIT 1`)
    .get(debateSessionId) as { status?: string } | undefined;
  db.close();
  return row?.status ?? null;
}
