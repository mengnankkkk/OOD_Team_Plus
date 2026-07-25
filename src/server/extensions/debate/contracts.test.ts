import { describe, expect, it } from "vitest";

import {
  AdvocateSpeechSchema,
  DebateArgumentSchema,
  DebateJudgementSchema,
  DebateRoundPlanSchema,
  DebateTurnSchema,
} from "./contracts";

describe("debate contracts", () => {
  it("parses a bull-supported round plan with the required speaking order", () => {
    const plan = DebateRoundPlanSchema.parse({
      userDebateRole: "neutral",
      userIntent: "support_bull",
      motion: "The company can sustain its current growth rate.",
      roundFocus: "Test the bull case against weakening evidence.",
      requiredAgents: ["evidence", "bull", "bear", "judge"],
      speakingOrder: ["evidence", "bull", "bear", "bull", "judge"],
      needsFreshData: true,
      reasonForFocus: "Recent guidance and valuation data need to be reconciled.",
    });

    expect(plan.userIntent).toBe("support_bull");
    expect(plan.speakingOrder).toEqual(["evidence", "bull", "bear", "bull", "judge"]);
  });

  it("rejects user and orchestrator speakers from a round plan", () => {
    const basePlan = {
      userDebateRole: "neutral",
      userIntent: "ask_both",
      motion: "The motion is debatable.",
      roundFocus: "Compare both sides.",
      requiredAgents: ["evidence", "bull", "bear", "judge"],
      needsFreshData: false,
      reasonForFocus: "The user asked for a balanced review.",
    };

    expect(() => DebateRoundPlanSchema.parse({
      ...basePlan,
      speakingOrder: ["user"],
    })).toThrow();
    expect(() => DebateRoundPlanSchema.parse({
      ...basePlan,
      speakingOrder: ["orchestrator"],
    })).toThrow();
  });

  it("parses advocate speech with an admitted weakness and argument defaults", () => {
    const speech = AdvocateSpeechSchema.parse({
      stance: "bull",
      headline: "The growth runway remains credible.",
      directResponseToUser: "The near-term slowdown does not invalidate the long-term case.",
      arguments: [{
        stance: "bull",
        claim: "Demand remains broad across the core product lines.",
        plainLanguage: "Customers are still buying the main products.",
        assumption: "The next product cycle launches on schedule.",
        confidence: 0.74,
        vulnerability: "A delayed launch would weaken this argument.",
      }],
      strongestAttackOnOpponent: "The bear case extrapolates one soft quarter too far.",
      admittedWeakness: "The valuation leaves less room for execution mistakes.",
      questionForOpponent: "What evidence would change your view?",
      plainLanguageSummary: "The upside case is intact, but execution matters.",
      suggestedUserFollowUp: "Ask whether the valuation already prices in the growth.",
    });

    expect(speech.admittedWeakness).toBe("The valuation leaves less room for execution mistakes.");
    expect(speech.arguments[0]?.evidenceRefs).toEqual([]);
    expect(speech.arguments[0]?.counterEvidenceRefs).toEqual([]);
  });

  it("rejects an advocate argument whose stance differs from the speech", () => {
    expect(() => AdvocateSpeechSchema.parse({
      stance: "bull",
      headline: "Headline",
      directResponseToUser: "Response",
      arguments: [{
        stance: "bear",
        claim: "Claim",
        plainLanguage: "Plain language",
        assumption: "Assumption",
        confidence: 0.5,
        vulnerability: "Vulnerability",
      }],
      strongestAttackOnOpponent: "Attack",
      admittedWeakness: "Weakness",
      questionForOpponent: "Question",
      plainLanguageSummary: "Summary",
      suggestedUserFollowUp: "Follow up",
    })).toThrow();
  });

  it("parses a judgement with insufficient evidence and bounded follow-up prompts", () => {
    const judgement = DebateJudgementSchema.parse({
      userClaim: "The stock is an attractive buy today.",
      bullStrongestPoint: "Earnings momentum could continue.",
      bearStrongestPoint: "The current price assumes strong execution.",
      keyDisagreement: "Whether growth durability is already reflected in the price.",
      responseQuality: {
        bull: "direct",
        bear: "partial",
      },
      evidenceTilt: "insufficient_evidence",
      confidence: 0.42,
      whyNotFinal: "The available evidence does not resolve the valuation question.",
      suggestedNextPrompts: [
        "Compare the current multiple with historical ranges.",
        "Check the latest management guidance.",
      ],
      complianceNote: "This is an analytical discussion, not individualized investment advice.",
    });

    expect(judgement.evidenceTilt).toBe("insufficient_evidence");
    expect(judgement.responseQuality.bear).toBe("partial");
  });

  it("parses a public judge turn with structured payload", () => {
    const turn = DebateTurnSchema.parse({
      speaker: "judge",
      stance: "neutral",
      turnType: "judge_summary",
      content: "The evidence is currently insufficient to declare a winner.",
      publicSummary: "Balanced debate; more evidence is needed.",
      structuredPayload: {
        evidenceTilt: "insufficient_evidence",
        confidence: 0.42,
      },
    });

    expect(turn.structuredPayload).toEqual({
      evidenceTilt: "insufficient_evidence",
      confidence: 0.42,
    });
  });

  it("rejects invalid judge turn stance and type combinations", () => {
    expect(() => DebateTurnSchema.parse({
      speaker: "judge",
      stance: "bull",
      turnType: "opening",
      content: "The judge supports the bull case.",
      publicSummary: "Invalid judge turn.",
    })).toThrow();
  });

  it("accepts an advocate turn when speaker, stance, and turn type align", () => {
    const turn = DebateTurnSchema.parse({
      speaker: "bull",
      stance: "bull",
      turnType: "support",
      content: "The bull case remains supported by durable demand.",
      publicSummary: "Bull support.",
    });

    expect(turn.structuredPayload).toEqual({});
  });

  it("enforces argument confidence and a one-to-three argument range", () => {
    expect(() => DebateArgumentSchema.parse({
      stance: "bull",
      claim: "Claim",
      plainLanguage: "Plain language",
      assumption: "Assumption",
      confidence: 1.1,
      vulnerability: "Vulnerability",
    })).toThrow();

    expect(() => AdvocateSpeechSchema.parse({
      stance: "bear",
      headline: "Headline",
      directResponseToUser: "Response",
      arguments: [],
      strongestAttackOnOpponent: "Attack",
      admittedWeakness: "Weakness",
      questionForOpponent: "Question",
      plainLanguageSummary: "Summary",
      suggestedUserFollowUp: "Follow up",
    })).toThrow();

    const argument = {
      stance: "bear" as const,
      claim: "Claim",
      plainLanguage: "Plain language",
      assumption: "Assumption",
      confidence: 0.5,
      vulnerability: "Vulnerability",
    };
    expect(() => AdvocateSpeechSchema.parse({
      stance: "bear",
      headline: "Headline",
      directResponseToUser: "Response",
      arguments: [argument, argument, argument, argument],
      strongestAttackOnOpponent: "Attack",
      admittedWeakness: "Weakness",
      questionForOpponent: "Question",
      plainLanguageSummary: "Summary",
      suggestedUserFollowUp: "Follow up",
    })).toThrow();
  });

  it("enforces unique required agents and schedules only required agents", () => {
    const basePlan = {
      userDebateRole: "neutral",
      userIntent: "ask_both",
      motion: "The motion is debatable.",
      roundFocus: "Compare both sides.",
      needsFreshData: false,
      reasonForFocus: "The user asked for a balanced review.",
    };

    expect(() => DebateRoundPlanSchema.parse({
      ...basePlan,
      requiredAgents: ["evidence", "bull", "bull"],
      speakingOrder: ["evidence", "bull"],
    })).toThrow();

    expect(() => DebateRoundPlanSchema.parse({
      ...basePlan,
      requiredAgents: ["evidence", "bull"],
      speakingOrder: ["evidence", "judge"],
    })).toThrow();
  });

  it("rejects more than three suggested next prompts", () => {
    expect(() => DebateJudgementSchema.parse({
      userClaim: "Claim",
      bullStrongestPoint: "Bull point",
      bearStrongestPoint: "Bear point",
      keyDisagreement: "Disagreement",
      responseQuality: {
        bull: "direct",
        bear: "partial",
      },
      evidenceTilt: "balanced",
      confidence: 0.5,
      whyNotFinal: "More evidence is needed.",
      suggestedNextPrompts: ["One", "Two", "Three", "Four"],
      complianceNote: "Note",
    })).toThrow();
  });
});
