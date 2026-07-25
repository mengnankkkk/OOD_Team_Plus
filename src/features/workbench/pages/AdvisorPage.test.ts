import { describe, expect, it, vi } from "vitest";
import type { OnboardingMessage } from "@/types/app/onboarding";
import type { DebatePack } from "@/services/debateService";
import {
  attachDebatePacks,
  debateEvidenceFacts,
  resolveDebateSendRole,
  restoredDebateState,
  restoredDebateSessionId,
  suggestedBattleDraft,
} from "./AdvisorPage";

function message(
  id: string,
  role: OnboardingMessage["role"],
  metadata: Record<string, unknown>,
): OnboardingMessage {
  return {
    id,
    role,
    content: id,
    metadata,
    createdAt: "2026-07-25T00:00:00.000Z",
    sessionId: "conversation-1",
  };
}

describe("AdvisorPage debate history", () => {
  it("attaches available packs without dropping messages when another pack fails", async () => {
    const rows = [
      message("plain", "advisor", {}),
      message("battle-1", "advisor", { debateSessionId: "debate-1" }),
      message("battle-2", "advisor", { debateSessionId: "debate-2" }),
      message("user", "user", { debateSessionId: "debate-1" }),
    ];
    const pack = { debateSessionId: "debate-1" } as DebatePack;
    const loader = vi.fn(async (sessionId: string) => {
      if (sessionId === "debate-2") throw new Error("pack unavailable");
      return pack;
    });

    const restored = await attachDebatePacks(rows, loader);

    expect(loader).toHaveBeenCalledTimes(2);
    expect(restored).toHaveLength(rows.length);
    expect(restored.find((item) => item.id === "battle-1")?.metadata.debatePack).toBe(pack);
    expect(restored.find((item) => item.id === "battle-2")?.metadata.debatePack).toBeUndefined();
    expect(restored.find((item) => item.id === "plain")).toEqual(rows[0]);
    expect(restored.find((item) => item.id === "user")?.metadata.debatePack).toBeUndefined();
    expect(restoredDebateSessionId(restored)).toBe("debate-1");
  });

  it("restores an in-flight debate and the user's last explicit role from user messages", () => {
    const rows = [
      message("opening", "user", {
        outputMode: "BATTLE",
        debateSessionId: "debate-running",
        userRole: "bull",
        roundIndex: 1,
      }),
    ];

    expect(restoredDebateState(rows)).toEqual({
      debateSessionId: "debate-running",
      userRole: "bull",
      roundIndex: 1,
    });
    expect(restoredDebateSessionId(rows)).toBe("debate-running");
  });

  it("loads the pack for a running debate that only has a persisted user message", async () => {
    const rows = [
      message("opening", "user", {
        outputMode: "BATTLE",
        debateSessionId: "debate-running",
        userRole: "neutral",
        roundIndex: 2,
      }),
    ];
    const loader = vi.fn(async () => twoRoundPack());

    const restored = await attachDebatePacks(rows, loader);

    expect(loader).toHaveBeenCalledWith("debate-running");
    expect(restored).toEqual(rows);
  });

  it("attaches only the matching round to each historical advisor message", async () => {
    const rows = [
      message("battle-r1", "advisor", {
        debateSessionId: "debate-1",
        roundId: "r1",
        debateMotion: "第一轮辩题",
        publication: null,
      }),
      message("battle-r2", "advisor", {
        debateSessionId: "debate-1",
        roundId: "r2",
        debateMotion: "第二轮辩题",
        publication: publication(),
      }),
    ];
    const pack = twoRoundPack();
    const loader = vi.fn(async () => pack);

    const restored = await attachDebatePacks(rows, loader);
    const firstPack = restored[0]?.metadata.debatePack as DebatePack;
    const secondPack = restored[1]?.metadata.debatePack as DebatePack;

    expect(loader).toHaveBeenCalledOnce();
    expect(firstPack.turns.map((turn) => turn.roundId)).toEqual(["r1", "r1"]);
    expect(firstPack.judgements.map((item) => item.roundId)).toEqual(["r1"]);
    expect(secondPack.turns.map((turn) => turn.roundId)).toEqual(["r2", "r2"]);
    expect(secondPack.judgements.map((item) => item.roundId)).toEqual(["r2"]);
    expect(firstPack).toMatchObject({ motion: "第一轮辩题", status: "COMPLETED", publication: null, evidence: [] });
    expect(secondPack).toMatchObject({ motion: "第二轮辩题", status: "COMPLETED", publication: publication(), evidence: [] });
    expect(debateEvidenceFacts(firstPack)).toEqual(["风险等级：C3", "第一轮市场事实"]);
    expect(debateEvidenceFacts(secondPack)).toEqual(["当前持仓：20%", "第二轮市场事实"]);
  });
});

describe("AdvisorPage debate role selection", () => {
  it("uses an explicit neutral role instead of a stale selected side", () => {
    expect(resolveDebateSendRole("bull", "neutral")).toBe("neutral");
    expect(resolveDebateSendRole("bear")).toBe("bear");
  });

  it("prepares a suggested Battle without auto-sending or overwriting the selected role", () => {
    expect(suggestedBattleDraft({
      recommended: true,
      motion: "该标的现在是否值得持有？",
      reason: "估值和趋势存在明显分歧。",
      targetSymbol: "AAPL.US",
    }, "bear")).toEqual({
      motion: "该标的现在是否值得持有？",
      targetSymbol: "AAPL.US",
      userRole: "bear",
    });
  });
});

function twoRoundPack(): DebatePack {
  return {
    debateSessionId: "debate-1",
    motion: "是否持有 AAPL",
    status: "ACTIVE",
    rounds: [
      { id: "r1", roundIndex: 1, status: "COMPLETED" },
      { id: "r2", roundIndex: 2, status: "COMPLETED" },
    ],
    turns: [
      {
        id: "e1",
        roundId: "r1",
        speaker: "evidence",
        stance: "neutral",
        turnType: "evidence_update",
        content: "",
        publicSummary: "第一轮证据",
        structuredPayload: { board: { profileFacts: ["风险等级：C3"], portfolioFacts: [], marketFacts: ["第一轮市场事实"] } },
      },
      {
        id: "b1",
        roundId: "r1",
        speaker: "bull",
        stance: "bull",
        turnType: "opening",
        content: "",
        publicSummary: "第一轮多方",
        structuredPayload: {},
      },
      {
        id: "e2",
        roundId: "r2",
        speaker: "evidence",
        stance: "neutral",
        turnType: "evidence_update",
        content: "",
        publicSummary: "第二轮证据",
        structuredPayload: { board: { profileFacts: [], portfolioFacts: ["当前持仓：20%"], marketFacts: ["第二轮市场事实"] } },
      },
      {
        id: "b2",
        roundId: "r2",
        speaker: "bear",
        stance: "bear",
        turnType: "rebuttal",
        content: "",
        publicSummary: "第二轮空方",
        structuredPayload: {},
      },
    ],
    judgements: [
      judgement("j1", "r1", "第一轮裁判"),
      judgement("j2", "r2", "第二轮裁判"),
    ],
    agentTrace: [],
    evidence: [],
    events: [],
    publication: null,
    disclaimer: "不构成交易指令",
  };
}

function publication(): NonNullable<DebatePack["publication"]> {
  return {
    analysisId: "analysis-publication",
    status: "DEGRADED",
    direction: "HOLD",
    action: "WATCH",
    answer: "继续观察。",
    recommendationId: null,
    missingInformation: [],
    provider: "CHIEF_ADVISOR",
  };
}

function judgement(id: string, roundId: string, summary: string): DebatePack["judgements"][number] {
  return {
    id,
    roundId,
    userClaim: "用户观点",
    bullStrongestPoint: "多方观点",
    bearStrongestPoint: "空方观点",
    keyDisagreement: "关键分歧",
    responseQuality: { bull: "direct", bear: "direct" },
    evidenceTilt: "balanced",
    confidence: 0.5,
    whyNotFinal: summary,
    suggestedNextPrompts: [],
    complianceNote: "仅研究",
  };
}
