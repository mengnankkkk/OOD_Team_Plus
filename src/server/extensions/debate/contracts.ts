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
  speakingOrder: z.array(DebateSpeakerSchema).min(1),
  needsFreshData: z.boolean(),
  reasonForFocus: z.string().min(1),
});

export const DebateTurnSchema = z.object({
  speaker: DebateSpeakerSchema,
  stance: DebateStanceSchema,
  turnType: DebateTurnTypeSchema,
  content: z.string().min(1),
  publicSummary: z.string().min(1),
  structuredPayload: z.record(z.string(), z.unknown()).default({}),
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
