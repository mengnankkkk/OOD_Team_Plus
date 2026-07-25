import { describe, expect, it } from "vitest";

import {
  coerceAdvocateSpeech,
  coerceDebateJudgement,
  coerceDebateRoundPlan,
} from "./debate-agents";
import {
  AdvocateSpeechSchema,
  DebateJudgementSchema,
  DebateRoundPlanSchema,
} from "@/server/extensions/debate/contracts";

describe("debate agent coercion", () => {
  it("normalizes sparse round plans while preserving valid role, intent, and speaking order", () => {
    const plan = coerceDebateRoundPlan({
      userDebateRole: "bear",
      userIntent: "challenge_bull",
      motion: "The valuation does not leave enough room for execution risk.",
      speakingOrder: ["evidence", "bear", "bull", "judge"],
    });

    expect(DebateRoundPlanSchema.parse(plan)).toEqual(plan);
    expect(plan.userDebateRole).toBe("bear");
    expect(plan.userIntent).toBe("challenge_bull");
    expect(plan.speakingOrder).toEqual(["evidence", "bear", "bull", "judge"]);
    expect(plan.requiredAgents).toEqual(expect.arrayContaining(["evidence", "bull", "bear", "judge"]));

    const fallbackPlan = coerceDebateRoundPlan({});

    expect(fallbackPlan.userDebateRole).toBe("neutral");
    expect(fallbackPlan.userIntent).toBe("ask_both");
    expect(fallbackPlan.requiredAgents).toEqual(expect.arrayContaining(["evidence", "bull", "bear", "judge"]));
  });

  it("coerces advocate speech into the requested stance and keeps it contract-valid", () => {
    const speech = coerceAdvocateSpeech("bull", {
      stance: "bear",
      headline: "The upside case still deserves attention.",
      directResponseToUser: "Your concern is fair, but the thesis needs a fuller evidence check.",
      arguments: [
        {
          stance: "bear",
          claim: "Demand can remain resilient.",
          plainLanguage: "Customers may keep buying.",
          assumption: "The next release arrives on time.",
          confidence: 0.72,
          vulnerability: "A delayed release would weaken this view.",
        },
        {
          claim: "Margins could improve.",
        },
        {
          claim: "Distribution remains broad.",
        },
        {
          claim: "This fourth argument must be removed.",
        },
      ],
      admittedWeakness: "The valuation makes disappointing execution costly.",
    });

    expect(AdvocateSpeechSchema.parse(speech)).toEqual(speech);
    expect(speech.stance).toBe("bull");
    expect(speech.arguments).toHaveLength(3);
    expect(speech.arguments.every((argument) => argument.stance === "bull")).toBe(true);
    expect(speech.arguments[0]?.claim).toBe("Demand can remain resilient.");
    expect(speech.arguments[0]?.counterEvidenceRefs).toHaveLength(1);
    expect(speech.admittedWeakness).toBe("The valuation makes disappointing execution costly.");
    expect(speech.strongestAttackOnOpponent).not.toHaveLength(0);

    const fallbackSpeech = coerceAdvocateSpeech("bear", { headline: "A cautious case needs testing." });

    expect(fallbackSpeech.admittedWeakness).not.toHaveLength(0);
    expect(fallbackSpeech.arguments[0]?.counterEvidenceRefs).toHaveLength(1);
  });

  it("returns a bounded, non-final judgement with research and simulation guidance", () => {
    const judgement = coerceDebateJudgement({
      userClaim: "The company is an obvious buy after its latest results.",
      confidence: 3,
      suggestedNextPrompts: ["Compare current valuation with history.", "", "Check latest guidance.", "Too many prompts."],
    });

    expect(DebateJudgementSchema.parse(judgement)).toEqual(judgement);
    expect(judgement.evidenceTilt).toBe("insufficient_evidence");
    expect(judgement.confidence).toBe(1);
    expect(judgement.whyNotFinal).not.toHaveLength(0);
    expect(judgement.suggestedNextPrompts).toHaveLength(3);
    expect(judgement.suggestedNextPrompts.every((prompt) => prompt.trim().length > 0)).toBe(true);
    expect(judgement.complianceNote).toMatch(/research|simulation/i);
  });
});
