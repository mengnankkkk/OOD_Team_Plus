import { describe, expect, it } from "vitest";

import { FrontendApiError } from "@/features/frontend-migration/api";
import { normalizeDebateSuggestion } from "./advisorService";
import {
  extractDebateTargetSymbol,
  formatDebateReply,
  debateStreamActivity,
  isDebatePackSettled,
  isDebateSessionUnavailable,
  selectDebateTargetSymbol,
  shouldFinishDebateStream,
  type DebatePack,
} from "./debateService";

describe("debateService helpers", () => {
  it("extracts explicit market symbols from novice questions", () => {
    expect(extractDebateTargetSymbol("我现在要不要加仓 510300.OF？")).toBe("510300.OF");
    expect(extractDebateTargetSymbol("AAPL.US 最近跌了还能买吗")).toBe("AAPL.US");
    expect(extractDebateTargetSymbol("是否继续持有 AAPL？")).toBe("AAPL");
    expect(extractDebateTargetSymbol("510300 最近跌了还能加仓吗")).toBe("510300");
  });

  it("uses only the advisor's structured battle suggestion", () => {
    expect(normalizeDebateSuggestion({
      recommended: true,
      motion: "是否继续持有 AAPL？",
      reason: "多空双方对趋势和估值存在明显分歧。",
    })).toEqual({
      recommended: true,
      motion: "是否继续持有 AAPL？",
      reason: "多空双方对趋势和估值存在明显分歧。",
    });
    expect(normalizeDebateSuggestion({
      recommended: false,
      motion: "是否继续持有 AAPL？",
      reason: "证据不足。",
    })).toBeNull();
    expect(normalizeDebateSuggestion({ recommended: true, motion: "是否继续持有 AAPL？" })).toBeNull();
  });

  it("formats a compact bull bear judge summary", () => {
    const text = formatDebateReply(mockPack());

    expect(text).toContain("多方：估值修复");
    expect(text).toContain("空方：趋势风险");
    expect(text).toContain("裁判：证据仍不足");
  });

  it("prefers the trusted target symbol carried by an Advisor suggestion", () => {
    expect(selectDebateTargetSymbol("AAPL.US", "该标的是否值得持有？")).toBe("AAPL.US");
    expect(selectDebateTargetSymbol(null, "是否继续持有 510300.OF？")).toBe("510300.OF");
  });

  it("does not treat an incomplete pack as a finished Battle", () => {
    const running = mockPack();
    running.rounds = [{ id: "r1", status: "RUNNING" }];
    running.judgements = [];
    expect(isDebatePackSettled(running)).toBe(false);

    const completed = mockPack();
    completed.rounds = [{ id: "r1", status: "COMPLETED" }];
    expect(isDebatePackSettled(completed)).toBe(true);

    const blocked = mockPack();
    blocked.status = "BLOCKED";
    blocked.rounds = [];
    blocked.judgements = [];
    expect(isDebatePackSettled(blocked)).toBe(true);
  });

  it("treats blocked and missing API sessions as recoverable Battle state", () => {
    expect(isDebateSessionUnavailable(new FrontendApiError("Debate is blocked", "DEBATE_BLOCKED", 409))).toBe(true);
    expect(isDebateSessionUnavailable(new FrontendApiError("Debate not found", "DEBATE_NOT_FOUND", 404))).toBe(true);
    expect(isDebateSessionUnavailable(new FrontendApiError("Other conflict", "RUN_ALREADY_ACTIVE", 409))).toBe(false);
  });

  it("settles and closes the stream only for the expected round", () => {
    const pack = mockPack();
    pack.rounds = [
      { id: "r1", roundIndex: 1, status: "COMPLETED" },
      { id: "r2", roundIndex: 2, status: "RUNNING" },
    ];
    pack.judgements = [{ ...pack.judgements[0]!, roundId: "r1" }];

    expect(isDebatePackSettled(pack, 1)).toBe(true);
    expect(isDebatePackSettled(pack, 2)).toBe(false);
    expect(shouldFinishDebateStream("debate.round.completed", { roundIndex: 1 }, 2)).toBe(false);
    expect(shouldFinishDebateStream("debate.round.completed", { roundIndex: 2 }, 2)).toBe(true);
    expect(shouldFinishDebateStream("debate.blocked", { roundIndex: 2 }, 2)).toBe(true);
    expect(shouldFinishDebateStream("debate.round.completed", {}, 2)).toBe(false);
  });

  it("maps persisted debate events to visible Battle roles", () => {
    expect(debateStreamActivity("debate.agent.started", { speaker: "bull" })).toMatchObject({
      role: "bull",
      phase: "started",
    });
    expect(debateStreamActivity("debate.agent.completed", { speaker: "bear" })).toMatchObject({
      role: "bear",
      phase: "completed",
    });
    expect(debateStreamActivity("debate.judge.started", { speaker: "judge" })).toMatchObject({
      role: "moderator",
      phase: "started",
    });
    expect(debateStreamActivity("debate.turn.completed", { speaker: "user" })).toMatchObject({
      role: "user",
      phase: "completed",
    });
    expect(debateStreamActivity("debate.agent.completed", { speaker: "orchestrator" })).toBeNull();
  });
});

function mockPack(): DebatePack {
  return {
    debateSessionId: "debate_1",
    motion: "是否加仓 510300",
    status: "ACTIVE",
    rounds: [],
    turns: [
      { id: "bull", roundId: "r1", speaker: "bull", stance: "bull", turnType: "opening", content: "", publicSummary: "估值修复", structuredPayload: {} },
      { id: "bear", roundId: "r1", speaker: "bear", stance: "bear", turnType: "rebuttal", content: "", publicSummary: "趋势风险", structuredPayload: {} },
    ],
    judgements: [{
      id: "judge",
      roundId: "r1",
      userClaim: "想加仓",
      bullStrongestPoint: "估值修复",
      bearStrongestPoint: "趋势风险",
      keyDisagreement: "估值是否便宜",
      responseQuality: { bull: "direct", bear: "direct" },
      evidenceTilt: "insufficient_evidence",
      confidence: 0.55,
      whyNotFinal: "证据仍不足",
      suggestedNextPrompts: ["继续追问估值"],
      complianceNote: "仅研究",
    }],
    agentTrace: [],
    evidence: [],
    events: [],
    publication: null,
    disclaimer: "不构成交易指令",
  };
}
