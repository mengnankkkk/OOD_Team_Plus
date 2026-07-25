import { describe, expect, it } from "vitest";

import { enforcePublicationStatus } from "./professional";
import {
  AdvisorDecisionSchema,
  AgentFindingSchema,
  DebateSuggestionSchema,
  attachTrustedTargetSymbol,
} from "./professional-contracts";

const baseDecision = {
  action: "WATCH" as const,
  requestedDirection: "HOLD" as const,
  summary: "暂不改变组合",
  suitability: "MEDIUM" as const,
  confidence: 0.8,
  rationales: ["证据仍需观察"],
  counterEvidence: ["历史表现不能保证未来走势"],
  risks: ["市场波动可能放大回撤"],
  portfolioImpact: "暂不改变组合",
  invalidationConditions: ["画像或数据发生变化"],
  compliance: { approved: true, decision: "APPROVED" as const, reason: "仅用于研究" },
};

describe("AdvisorDecisionSchema", () => {
  it("requires the LLM to return a structured debate suggestion", () => {
    expect(() => AdvisorDecisionSchema.parse(baseDecision)).toThrow();
  });

  it("preserves the structured debate suggestion from the LLM decision", () => {
    const decision = AdvisorDecisionSchema.parse({
      ...baseDecision,
      debateSuggestion: {
        recommended: true,
        motion: "未来 1-3 个月是否应继续持有该标的",
        reason: "多空证据存在真实分歧，适合让用户比较双方依据",
      },
    });

    expect(decision.debateSuggestion).toEqual({
      recommended: true,
      motion: "未来 1-3 个月是否应继续持有该标的",
      reason: "多空证据存在真实分歧，适合让用户比较双方依据",
    });
  });

  it("does not publish ACTIVE when compliance.decision is not APPROVED", () => {
    const candidate = AdvisorDecisionSchema.parse({
      ...baseDecision,
      compliance: { approved: true, decision: "DOWNGRADED", reason: "仍需补充复核" },
      debateSuggestion: {
        recommended: false,
        motion: "当前问题暂不适合进入多空 Battle",
        reason: "合规结论尚未通过。",
      },
    });
    const finding = AgentFindingSchema.parse({
      agent: "PROFILE_CONTEXT",
      conclusion: "画像完整",
      supportEvidence: ["画像已验证"],
      counterEvidence: ["画像可能变化"],
      missingInformation: [],
      risks: ["资金用途可能变化"],
      confidence: 0.8,
      needsAnotherAgent: false,
    });

    expect(enforcePublicationStatus({
      candidate,
      criticalMissing: [],
      dataState: "NOT_REQUIRED",
      findings: [finding],
      modelFallback: false,
      unresolvedConflict: false,
      marketDataRequired: false,
    })).toBe("DEGRADED");
  });

  it("keeps model fallback decisions below ACTIVE", () => {
    const candidate = AdvisorDecisionSchema.parse({
      ...baseDecision,
      debateSuggestion: {
        recommended: false,
        motion: "当前问题暂不适合进入多空 Battle",
        reason: "模型不可用时只保留降级候选。",
      },
    });
    const finding = AgentFindingSchema.parse({
      agent: "PROFILE_CONTEXT",
      conclusion: "画像完整",
      supportEvidence: ["画像已验证"],
      counterEvidence: ["画像可能变化"],
      missingInformation: [],
      risks: ["资金用途可能变化"],
      confidence: 0.8,
      needsAnotherAgent: false,
    });

    expect(enforcePublicationStatus({
      candidate,
      criticalMissing: [],
      dataState: "NOT_REQUIRED",
      findings: [finding],
      modelFallback: true,
      unresolvedConflict: false,
      marketDataRequired: false,
    })).toBe("DEGRADED");
  });

  it("preserves an optional nullable trusted target symbol", () => {
    const targeted = DebateSuggestionSchema.parse({
      recommended: true,
      motion: "未来 1-3 个月是否应继续持有该标的",
      reason: "多空证据存在真实分歧。",
      targetSymbol: "510300.OF",
    });
    const untargeted = DebateSuggestionSchema.parse({
      recommended: true,
      motion: "当前市场观点是否成立",
      reason: "这是一个不依赖单一标的的市场问题。",
      targetSymbol: null,
    });

    expect(targeted.targetSymbol).toBe("510300.OF");
    expect(untargeted.targetSymbol).toBeNull();
  });

  it("replaces model-provided symbols with trusted server context only for recommended suggestions", () => {
    const modelSuggestion = DebateSuggestionSchema.parse({
      recommended: true,
      motion: "未来 1-3 个月是否应继续持有该标的",
      reason: "多空证据存在真实分歧。",
      targetSymbol: "MODEL-GUESSED",
    });
    expect(attachTrustedTargetSymbol(modelSuggestion, "510300.OF")).toEqual({
      recommended: true,
      motion: modelSuggestion.motion,
      reason: modelSuggestion.reason,
      targetSymbol: "510300.OF",
    });
    expect(attachTrustedTargetSymbol({ ...modelSuggestion, recommended: false }, "510300.OF")).not.toHaveProperty("targetSymbol");
    expect(attachTrustedTargetSymbol(modelSuggestion, null)).toMatchObject({ targetSymbol: null });
  });
});
