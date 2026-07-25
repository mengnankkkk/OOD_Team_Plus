/* eslint-disable max-lines */
import { describe, expect, it } from "vitest";

import {
  coerceAdvocateSpeech,
  coerceDebateJudgement,
  coerceDebateRoundPlan,
  retryStructuredAttempt,
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
    expect(plan.speakingOrder).toEqual(["evidence", "bear", "bull", "bear", "bull", "judge"]);
    expect(plan.requiredAgents).toEqual(expect.arrayContaining(["evidence", "bull", "bear", "judge"]));

    const fallbackPlan = coerceDebateRoundPlan({});

    expect(fallbackPlan.userDebateRole).toBe("neutral");
    expect(fallbackPlan.userIntent).toBe("ask_both");
    expect(fallbackPlan.requiredAgents).toEqual(expect.arrayContaining(["evidence", "bull", "bear", "judge"]));
  });

  it("keeps chief advisor as a publication agent outside the speaking order", () => {
    const plan = coerceDebateRoundPlan({
      requiredAgents: ["evidence", "bull", "bear", "judge"],
      speakingOrder: ["evidence", "chief_advisor", "bull", "bear", "judge"],
    });

    expect(DebateRoundPlanSchema.parse(plan)).toEqual(plan);
    expect(plan.speakingOrder).toEqual(["evidence", "bull", "bear", "bull", "bear", "judge"]);
    expect(plan.requiredAgents).toEqual(expect.arrayContaining(["evidence", "bull", "bear", "judge", "chief_advisor"]));
  });

  it("expands a narrow model plan into a balanced round", () => {
    const plan = coerceDebateRoundPlan({
      requiredAgents: ["bull"],
      speakingOrder: ["bull"],
    });

    expect(DebateRoundPlanSchema.parse(plan)).toEqual(plan);
    expect(plan.requiredAgents).toEqual(expect.arrayContaining(["evidence", "bull", "bear", "judge"]));
    expect(plan.speakingOrder).toEqual(["evidence", "bull", "bear", "bull", "bear", "judge"]);
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
    expect(speech.arguments[0]?.counterEvidenceRefs).toEqual([]);
    expect(speech.admittedWeakness).toBe("The valuation makes disappointing execution costly.");
    expect(speech.strongestAttackOnOpponent).not.toHaveLength(0);

    const fallbackSpeech = coerceAdvocateSpeech("bear", { headline: "A cautious case needs testing." });

    expect(fallbackSpeech.admittedWeakness).not.toHaveLength(0);
    expect(fallbackSpeech.arguments[0]?.counterEvidenceRefs).toEqual([]);
  });

  it("neutralizes advocate-authored trade directives while preserving attributed claims", () => {
    const directives = coerceAdvocateSpeech("bull", {
      headline: "立即买入 AAPL",
      directResponseToUser: "Based on the evidence you should buy AAPL",
      arguments: [{
        claim: "You must add AAPL",
        plainLanguage: "综合来看你应该加仓 AAPL",
        assumption: "The evidence means you should hold AAPL",
        vulnerability: "风险变化说明你必须卖出 AAPL",
      }],
      strongestAttackOnOpponent: "I recommend selling AAPL",
      admittedWeakness: "应该减仓 AAPL",
      questionForOpponent: "You should buy AAPL",
      plainLanguageSummary: "综合证据看你应该买入 AAPL",
      suggestedUserFollowUp: "马上买入 AAPL",
    });
    const attributed = coerceAdvocateSpeech("bear", {
      directResponseToUser: "The bull says you should buy AAPL, but the evidence is incomplete.",
      plainLanguageSummary: "多方认为你应该买入 AAPL，但证据不足。",
    });

    expect(directives.headline).toMatch(/evidence|research/i);
    expect(directives.directResponseToUser).toMatch(/evidence|research/i);
    expect(directives.arguments[0]?.claim).toMatch(/evidence|research/i);
    expect(directives.arguments[0]?.plainLanguage).toMatch(/evidence|research/i);
    expect(directives.arguments[0]?.assumption).toMatch(/evidence|research/i);
    expect(directives.arguments[0]?.vulnerability).toMatch(/evidence|research/i);
    expect(directives.strongestAttackOnOpponent).toMatch(/evidence|research/i);
    expect(directives.admittedWeakness).toMatch(/evidence|research/i);
    expect(directives.questionForOpponent).toMatch(/evidence|research/i);
    expect(directives.plainLanguageSummary).toMatch(/evidence|research/i);
    expect(directives.suggestedUserFollowUp).toMatch(/evidence|research/i);
    expect(attributed.directResponseToUser).toBe("The bull says you should buy AAPL, but the evidence is incomplete.");
    expect(attributed.plainLanguageSummary).toBe("多方认为你应该买入 AAPL，但证据不足。");
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

  it("keeps quoted user commands while neutralizing judge-authored trade commands", () => {
    const judgement = coerceDebateJudgement({
      userClaim: "The user asks whether they should buy now.",
      bullStrongestPoint: "Buy now because the result was strong.",
      bearStrongestPoint: "立即买入 would be too risky.",
      keyDisagreement: "必须加仓 versus waiting for proof.",
      whyNotFinal: "马上卖出 if the next report disappoints.",
      suggestedNextPrompts: ["Sell now.", "Compare current valuation with history."],
      complianceNote: "应该减仓 after this debate.",
    });

    expect(judgement.userClaim).toBe("The user asks whether they should buy now.");
    expect(judgement.bullStrongestPoint).toMatch(/evidence|research/i);
    expect(judgement.bearStrongestPoint).toMatch(/evidence|research/i);
    expect(judgement.keyDisagreement).toMatch(/evidence|research/i);
    expect(judgement.whyNotFinal).toMatch(/evidence|research/i);
    expect(judgement.suggestedNextPrompts[0]).toMatch(/evidence|research/i);
    expect(judgement.suggestedNextPrompts[1]).toBe("Compare current valuation with history.");
    expect(judgement.complianceNote).toMatch(/research and simulation/i);
  });

  it("neutralizes direct trade command variants without changing analytical language or user claims", () => {
    const judgement = coerceDebateJudgement({
      userClaim: "The user quotes: Buy AAPL now.",
      bullStrongestPoint: "Buy AAPL.",
      bearStrongestPoint: "Sell your holdings now.",
      keyDisagreement: "Exit your position.",
      whyNotFinal: "You should sell AAPL.",
      suggestedNextPrompts: [
        "Immediately buy AAPL.",
        "加仓 510300",
        "立即买入 510300",
      ],
      complianceNote: "应该减仓",
    });

    expect(judgement.userClaim).toBe("The user quotes: Buy AAPL now.");
    expect(judgement.bullStrongestPoint).toMatch(/evidence|research/i);
    expect(judgement.bearStrongestPoint).toMatch(/evidence|research/i);
    expect(judgement.keyDisagreement).toMatch(/evidence|research/i);
    expect(judgement.whyNotFinal).toMatch(/evidence|research/i);
    expect(judgement.suggestedNextPrompts[0]).toMatch(/evidence|research/i);
    expect(judgement.suggestedNextPrompts[1]).toMatch(/evidence|research/i);
    expect(judgement.suggestedNextPrompts[2]).toMatch(/evidence|research/i);
    expect(judgement.complianceNote).toMatch(/research and simulation/i);
  });

  it("preserves quoted and analytical judge content that is not a field-leading command", () => {
    const judgement = coerceDebateJudgement({
      userClaim: 'The user said "Buy AAPL now".',
      bullStrongestPoint: "The bull case discusses buying pressure.",
      bearStrongestPoint: 'The user said "Buy AAPL now".',
    });

    expect(judgement.userClaim).toBe('The user said "Buy AAPL now".');
    expect(judgement.bullStrongestPoint).toBe("The bull case discusses buying pressure.");
    expect(judgement.bearStrongestPoint).toBe('The user said "Buy AAPL now".');
  });

  it("neutralizes judge recommendation directives while preserving attributed analysis", () => {
    const directives = coerceDebateJudgement({
      userClaim: 'The user said "Recommendation: Buy AAPL."',
      bullStrongestPoint: "Recommendation: Buy AAPL.",
      bearStrongestPoint: "Action: Sell AAPL.",
      keyDisagreement: "Hold AAPL.",
      whyNotFinal: "Trade AAPL.",
      suggestedNextPrompts: [
        "I recommend buying AAPL.",
        "I recommend selling AAPL.",
        "I recommend holding AAPL.",
      ],
      complianceNote: "I recommend trading AAPL.",
    });
    const shouldDirectives = coerceDebateJudgement({
      bullStrongestPoint: "You should hold AAPL.",
      bearStrongestPoint: "You should trade AAPL.",
    });
    const analytical = coerceDebateJudgement({
      bullStrongestPoint: "The recommendation section discusses holding-period risk.",
    });

    expect(directives.userClaim).toBe('The user said "Recommendation: Buy AAPL."');
    expect(directives.bullStrongestPoint).toMatch(/evidence|research/i);
    expect(directives.bearStrongestPoint).toMatch(/evidence|research/i);
    expect(directives.keyDisagreement).toMatch(/evidence|research/i);
    expect(directives.whyNotFinal).toMatch(/evidence|research/i);
    expect(directives.suggestedNextPrompts.every((prompt) => /evidence|research/i.test(prompt))).toBe(true);
    expect(directives.complianceNote).toMatch(/research and simulation/i);
    expect(shouldDirectives.bullStrongestPoint).toMatch(/evidence|research/i);
    expect(shouldDirectives.bearStrongestPoint).toMatch(/evidence|research/i);
    expect(analytical.bullStrongestPoint).toBe("The recommendation section discusses holding-period risk.");
  });

  it("parses leading advice prefixes without changing attributed or quoted analysis", () => {
    const directives = coerceDebateJudgement({
      bullStrongestPoint: "I recommend that you buy AAPL.",
      bearStrongestPoint: "I recommend you trade AAPL.",
      keyDisagreement: "My recommendation is to hold AAPL.",
    });
    const safe = coerceDebateJudgement({
      bullStrongestPoint: "The analyst said to buy AAPL after earnings.",
      bearStrongestPoint: '"Buy AAPL" is a quoted user claim.',
      keyDisagreement: "The recommendation section discusses holding-period risk.",
    });

    expect(directives.bullStrongestPoint).toMatch(/evidence|research/i);
    expect(directives.bearStrongestPoint).toMatch(/evidence|research/i);
    expect(directives.keyDisagreement).toMatch(/evidence|research/i);
    expect(safe.bullStrongestPoint).toBe("The analyst said to buy AAPL after earnings.");
    expect(safe.bearStrongestPoint).toBe('"Buy AAPL" is a quoted user claim.');
    expect(safe.keyDisagreement).toBe("The recommendation section discusses holding-period risk.");
  });

  it("neutralizes embedded trade directives while preserving attributed recommendations", () => {
    const directives = coerceDebateJudgement({
      bullStrongestPoint: "综合来看，建议买入 AAPL。",
      bearStrongestPoint: "Based on the evidence, YOU SHOULD BUY AAPL.",
      keyDisagreement: "权衡风险后，应该减仓 510300。",
      whyNotFinal: "After reviewing the downside, I ReCoMmEnD selling AAPL.",
      suggestedNextPrompts: ["多方建议买入，但证据不足。Based on the evidence, you should BUY AAPL."],
    });
    const attributed = coerceDebateJudgement({
      bullStrongestPoint: "多方建议买入，但证据不足。",
      bearStrongestPoint: "The bull case says you should buy AAPL, but the evidence is incomplete.",
      keyDisagreement: "多方认为你应该买入 AAPL，但空方认为证据不足。",
    });
    const mixed = coerceDebateJudgement({
      keyDisagreement: "多方认为你应该买入 AAPL，但你必须卖出 AAPL。",
      whyNotFinal: "The bull says you should buy AAPL, but you must sell AAPL.",
    });

    expect(directives.bullStrongestPoint).toMatch(/evidence|research/i);
    expect(directives.bearStrongestPoint).toMatch(/evidence|research/i);
    expect(directives.keyDisagreement).toMatch(/evidence|research/i);
    expect(directives.whyNotFinal).toMatch(/evidence|research/i);
    expect(directives.suggestedNextPrompts[0]).toBe("Ask for fresh research that could change the current conclusion.");
    expect(attributed.bullStrongestPoint).toBe("多方建议买入，但证据不足。");
    expect(attributed.bearStrongestPoint).toBe("The bull case says you should buy AAPL, but the evidence is incomplete.");
    expect(attributed.keyDisagreement).toBe("多方认为你应该买入 AAPL，但空方认为证据不足。");
    expect(mixed.keyDisagreement).toMatch(/evidence|research/i);
    expect(mixed.whyNotFinal).toMatch(/evidence|research/i);
  });

  it("neutralizes unpunctuated directives embedded inside a sentence", () => {
    const directives = coerceDebateJudgement({
      bullStrongestPoint: "综合证据看你应该买入 AAPL",
      bearStrongestPoint: "The evidence means you should buy AAPL",
      keyDisagreement: "风险变化说明你必须减仓 510300",
      whyNotFinal: "After reviewing the evidence I recommend selling AAPL",
    });

    expect(directives.bullStrongestPoint).toMatch(/evidence|research/i);
    expect(directives.bearStrongestPoint).toMatch(/evidence|research/i);
    expect(directives.keyDisagreement).toMatch(/evidence|research/i);
    expect(directives.whyNotFinal).toMatch(/evidence|research/i);
  });

  it("retries one structured attempt before returning the successful result", async () => {
    let attempts = 0;

    const result = await retryStructuredAttempt(async (attempt) => {
      attempts += 1;
      if (attempt === 0) throw new Error("first structured output failed");
      return "second structured output";
    });

    expect(result).toBe("second structured output");
    expect(attempts).toBe(2);
  });

  it("propagates the second structured attempt failure", async () => {
    const failure = new Error("second structured output failed");
    let attempts = 0;

    await expect(retryStructuredAttempt(async () => {
      attempts += 1;
      throw failure;
    })).rejects.toBe(failure);

    expect(attempts).toBe(2);
  });
});
