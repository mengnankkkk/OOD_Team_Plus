import { z } from "zod";

export const DebateUserRoleSchema = z.enum(["neutral", "bull", "bear"]);
export const DebateSpeakerSchema = z.enum(["user", "bull", "bear", "judge", "orchestrator", "evidence"]);
export const DebateStanceSchema = z.enum(["bull", "bear", "neutral"]);
export const DebateAgentSchema = z.enum(["evidence", "bull", "bear", "judge", "chief_advisor"]);
export const DebateUserIntentSchema = z.enum([
  "ask_both",
  "support_bull",
  "support_bear",
  "challenge_bull",
  "challenge_bear",
  "ask_judge",
  "provide_evidence",
]);
export const DebateTurnTypeSchema = z.enum([
  "opening",
  "support",
  "rebuttal",
  "cross_examination",
  "answer",
  "judge_summary",
  "evidence_update",
]);
export const DebateEvidenceTiltSchema = z.enum([
  "bull_slightly_stronger",
  "bear_slightly_stronger",
  "balanced",
  "insufficient_evidence",
]);
export const DebateResponseQualitySchema = z.enum(["direct", "partial", "evasive", "not_applicable"]);

export const DebateArgumentSchema = z.object({
  stance: z.enum(["bull", "bear"]),
  claim: z.string().min(1),
  plainLanguage: z.string().min(1),
  evidenceRefs: z.array(z.string()).default([]),
  counterEvidenceRefs: z.array(z.string()).default([]),
  assumption: z.string().min(1),
  confidence: z.number().min(0).max(1),
  vulnerability: z.string().min(1),
});

export const AdvocateSpeechSchema = z.object({
  stance: z.enum(["bull", "bear"]),
  headline: z.string().min(1),
  directResponseToUser: z.string().min(1),
  arguments: z.array(DebateArgumentSchema).min(1).max(3),
  strongestAttackOnOpponent: z.string().min(1),
  admittedWeakness: z.string().min(1),
  questionForOpponent: z.string().min(1),
  plainLanguageSummary: z.string().min(1),
  suggestedUserFollowUp: z.string().min(1),
}).superRefine((speech, context) => {
  speech.arguments.forEach((argument, index) => {
    if (argument.stance !== speech.stance) {
      context.addIssue({
        code: "custom",
        path: ["arguments", index, "stance"],
        message: "Argument stance must match advocate speech stance",
      });
    }
  });
});

export const DebateJudgementSchema = z.object({
  userClaim: z.string().min(1),
  bullStrongestPoint: z.string().min(1),
  bearStrongestPoint: z.string().min(1),
  keyDisagreement: z.string().min(1),
  responseQuality: z.object({
    bull: DebateResponseQualitySchema,
    bear: DebateResponseQualitySchema,
  }),
  evidenceTilt: DebateEvidenceTiltSchema,
  confidence: z.number().min(0).max(1),
  whyNotFinal: z.string().min(1),
  suggestedNextPrompts: z.array(z.string().min(1)).min(1).max(3),
  complianceNote: z.string().min(1),
});

export const DebateRoundPlanSchema = z.object({
  userDebateRole: DebateUserRoleSchema,
  userIntent: DebateUserIntentSchema,
  motion: z.string().min(1),
  roundFocus: z.string().min(1),
  requiredAgents: z.array(DebateAgentSchema).min(1),
  speakingOrder: z.array(DebateAgentSchema).min(1),
  needsFreshData: z.boolean(),
  reasonForFocus: z.string().min(1),
}).superRefine((plan, context) => {
  if (new Set(plan.requiredAgents).size !== plan.requiredAgents.length) {
    context.addIssue({
      code: "custom",
      path: ["requiredAgents"],
      message: "Required agents must be unique",
    });
  }

  plan.speakingOrder.forEach((agent, index) => {
    if (!plan.requiredAgents.includes(agent)) {
      context.addIssue({
        code: "custom",
        path: ["speakingOrder", index],
        message: "Every speaking order entry must be a required agent",
      });
    }
  });
});

const advocateTurnTypes = new Set(["opening", "support", "rebuttal", "cross_examination", "answer"]);

export const DebateTurnSchema = z.object({
  speaker: DebateSpeakerSchema,
  stance: DebateStanceSchema,
  turnType: DebateTurnTypeSchema,
  content: z.string().min(1),
  publicSummary: z.string().min(1),
  structuredPayload: z.record(z.string(), z.unknown()).default({}),
}).superRefine((turn, context) => {
  if (["judge", "evidence", "orchestrator"].includes(turn.speaker) && turn.stance !== "neutral") {
    context.addIssue({
      code: "custom",
      path: ["stance"],
      message: `${turn.speaker} turns must use neutral stance`,
    });
  }

  if (turn.speaker === "judge" && turn.turnType !== "judge_summary") {
    context.addIssue({
      code: "custom",
      path: ["turnType"],
      message: "Judge turns must use judge_summary",
    });
  }

  if (turn.speaker === "evidence" && turn.turnType !== "evidence_update") {
    context.addIssue({
      code: "custom",
      path: ["turnType"],
      message: "Evidence turns must use evidence_update",
    });
  }

  if (turn.speaker === "orchestrator" && turn.turnType !== "opening") {
    context.addIssue({
      code: "custom",
      path: ["turnType"],
      message: "Orchestrator turns must use opening",
    });
  }

  if (turn.speaker === "bull" || turn.speaker === "bear") {
    if (turn.stance !== turn.speaker) {
      context.addIssue({
        code: "custom",
        path: ["stance"],
        message: "Advocate stance must match speaker",
      });
    }
    if (!advocateTurnTypes.has(turn.turnType)) {
      context.addIssue({
        code: "custom",
        path: ["turnType"],
        message: "Advocate turns must use an advocate turn type",
      });
    }
  }
});

export type DebateUserRole = z.infer<typeof DebateUserRoleSchema>;
export type DebateSpeaker = z.infer<typeof DebateSpeakerSchema>;
export type DebateStance = z.infer<typeof DebateStanceSchema>;
export type DebateAgent = z.infer<typeof DebateAgentSchema>;
export type DebateUserIntent = z.infer<typeof DebateUserIntentSchema>;
export type DebateTurnType = z.infer<typeof DebateTurnTypeSchema>;
export type DebateEvidenceTilt = z.infer<typeof DebateEvidenceTiltSchema>;
export type DebateResponseQuality = z.infer<typeof DebateResponseQualitySchema>;
export type DebateArgument = z.infer<typeof DebateArgumentSchema>;
export type AdvocateSpeech = z.infer<typeof AdvocateSpeechSchema>;
export type DebateJudgement = z.infer<typeof DebateJudgementSchema>;
export type DebateRoundPlan = z.infer<typeof DebateRoundPlanSchema>;
export type DebateTurn = z.infer<typeof DebateTurnSchema>;
