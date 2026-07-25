import { z } from "zod";

import {
  AdvocateSpeechSchema,
  DebateAgentSchema,
  DebateEvidenceTiltSchema,
  DebateJudgementSchema,
  DebateResponseQualitySchema,
  DebateRoundPlanSchema,
  DebateStanceSchema,
  DebateUserIntentSchema,
  DebateUserRoleSchema,
  type AdvocateSpeech,
  type DebateAgent,
  type DebateJudgement,
  type DebateRoundPlan,
  type DebateStance,
} from "@/server/extensions/debate/contracts";
import { neutralizeJudgeNarrative } from "./debate-judge-safety";

const DEFAULT_DEBATE_AGENTS: DebateAgent[] = ["evidence", "bull", "bear", "judge"];
const JUDGE_FALLBACKS = {
  bull: "The bull case did not provide a complete strongest point, so the evidence should be reviewed directly.",
  bear: "The bear case did not provide a complete strongest point, so the evidence should be reviewed directly.",
  disagreement: "The key disagreement is whether the available evidence supports the claim strongly enough.",
  notFinal: "The evidence and assumptions remain incomplete, so this discussion cannot settle the question.",
  prompt: "Ask for fresh research that could change the current conclusion.",
  compliance: "This is research and simulation for education, not individualized investment advice or an instruction to trade.",
} as const;

export const DebateRoundPlanOutputSchema = z.object({
  userDebateRole: DebateUserRoleSchema.optional(),
  userIntent: DebateUserIntentSchema.optional(),
  motion: z.string().optional(),
  roundFocus: z.string().optional(),
  requiredAgents: z.array(DebateAgentSchema).optional(),
  speakingOrder: z.array(DebateAgentSchema).optional(),
  needsFreshData: z.boolean().optional(),
  reasonForFocus: z.string().optional(),
});

const AdvocateArgumentOutputSchema = z.object({
  stance: DebateStanceSchema.optional(),
  claim: z.string().optional(),
  plainLanguage: z.string().optional(),
  evidenceRefs: z.array(z.string()).optional(),
  counterEvidenceRefs: z.array(z.string()).optional(),
  assumption: z.string().optional(),
  confidence: z.number().optional(),
  vulnerability: z.string().optional(),
});

export const AdvocateSpeechOutputSchema = z.object({
  stance: DebateStanceSchema.optional(),
  headline: z.string().optional(),
  directResponseToUser: z.string().optional(),
  arguments: z.array(AdvocateArgumentOutputSchema).optional(),
  strongestAttackOnOpponent: z.string().optional(),
  admittedWeakness: z.string().optional(),
  questionForOpponent: z.string().optional(),
  plainLanguageSummary: z.string().optional(),
  suggestedUserFollowUp: z.string().optional(),
});

export const DebateJudgementOutputSchema = z.object({
  userClaim: z.string().optional(),
  bullStrongestPoint: z.string().optional(),
  bearStrongestPoint: z.string().optional(),
  keyDisagreement: z.string().optional(),
  responseQuality: z.object({
    bull: DebateResponseQualitySchema.optional(),
    bear: DebateResponseQualitySchema.optional(),
  }).optional(),
  evidenceTilt: DebateEvidenceTiltSchema.optional(),
  confidence: z.number().optional(),
  whyNotFinal: z.string().optional(),
  suggestedNextPrompts: z.array(z.string()).optional(),
  complianceNote: z.string().optional(),
});

export function coerceDebateRoundPlan(value: unknown): DebateRoundPlan {
  const record = normalizeRecord(value);
  const scheduledAgents = debateAgentsFrom(record.speakingOrder);
  const modelRequiredAgents = debateAgentsFrom(record.requiredAgents);
  const requiredAgents = uniqueDebateAgents(
    modelRequiredAgents.length ? modelRequiredAgents : DEFAULT_DEBATE_AGENTS,
    scheduledAgents,
  );
  const speakingOrder = scheduledAgents.length ? scheduledAgents : [...requiredAgents];

  return DebateRoundPlanSchema.parse({
    userDebateRole: parseEnum(DebateUserRoleSchema, record.userDebateRole) ?? "neutral",
    userIntent: parseEnum(DebateUserIntentSchema, record.userIntent) ?? "ask_both",
    motion: nonEmptyString(record.motion, "Examine the user's claim using the available evidence."),
    roundFocus: nonEmptyString(record.roundFocus, "Compare the strongest evidence and unresolved assumptions on both sides."),
    requiredAgents,
    speakingOrder,
    needsFreshData: typeof record.needsFreshData === "boolean" ? record.needsFreshData : false,
    reasonForFocus: nonEmptyString(record.reasonForFocus, "The available evidence needs a balanced adversarial review."),
  });
}

export function coerceAdvocateSpeech(stance: "bull" | "bear", value: unknown): AdvocateSpeech {
  const record = normalizeRecord(value);
  const argumentsForStance = (Array.isArray(record.arguments) ? record.arguments : [])
    .slice(0, 3)
    .map((argument) => coerceAdvocateArgument(stance, argument));

  return AdvocateSpeechSchema.parse({
    stance,
    headline: nonEmptyString(record.headline, `${stanceLabel(stance)} case: test the evidence before accepting the thesis.`),
    directResponseToUser: nonEmptyString(record.directResponseToUser, "Your claim deserves a direct comparison of the available evidence and its limitations."),
    arguments: argumentsForStance.length ? argumentsForStance : [coerceAdvocateArgument(stance, {})],
    strongestAttackOnOpponent: nonEmptyString(record.strongestAttackOnOpponent, "The opposing case must explain which evidence would invalidate its core assumption."),
    admittedWeakness: nonEmptyString(record.admittedWeakness, "This case remains vulnerable to evidence that the central assumption does not hold."),
    questionForOpponent: nonEmptyString(record.questionForOpponent, "Which specific evidence would most directly challenge your conclusion?"),
    plainLanguageSummary: nonEmptyString(record.plainLanguageSummary, "This is one side of the debate, so its assumptions and counter-evidence still need scrutiny."),
    suggestedUserFollowUp: nonEmptyString(record.suggestedUserFollowUp, "Ask for the strongest evidence against this case and what would change the conclusion."),
  });
}

export function coerceDebateJudgement(value: unknown): DebateJudgement {
  const record = normalizeRecord(value);
  const responseQuality = normalizeRecord(record.responseQuality);
  const suggestedNextPrompts = stringArray(record.suggestedNextPrompts)
    .slice(0, 3)
    .map((prompt) => neutralizeJudgeNarrative(prompt, JUDGE_FALLBACKS.prompt));
  const complianceNote = neutralizeJudgeNarrative(
    nonEmptyString(record.complianceNote, JUDGE_FALLBACKS.compliance),
    JUDGE_FALLBACKS.compliance,
  );

  return DebateJudgementSchema.parse({
    userClaim: nonEmptyString(record.userClaim, "The user's claim needs a balanced evidence review."),
    bullStrongestPoint: judgeNarrative(record.bullStrongestPoint, JUDGE_FALLBACKS.bull),
    bearStrongestPoint: judgeNarrative(record.bearStrongestPoint, JUDGE_FALLBACKS.bear),
    keyDisagreement: judgeNarrative(record.keyDisagreement, JUDGE_FALLBACKS.disagreement),
    responseQuality: {
      bull: parseEnum(DebateResponseQualitySchema, responseQuality.bull) ?? "not_applicable",
      bear: parseEnum(DebateResponseQualitySchema, responseQuality.bear) ?? "not_applicable",
    },
    evidenceTilt: parseEnum(DebateEvidenceTiltSchema, record.evidenceTilt) ?? "insufficient_evidence",
    confidence: coerceConfidence(record.confidence),
    whyNotFinal: judgeNarrative(record.whyNotFinal, JUDGE_FALLBACKS.notFinal),
    suggestedNextPrompts: suggestedNextPrompts.length ? suggestedNextPrompts : [
      "What fresh evidence would most weaken the bull case?",
      "What fresh evidence would most weaken the bear case?",
      "Which assumption should be checked with current research?",
    ],
    complianceNote: includesResearchAndSimulation(complianceNote)
      ? complianceNote
      : `${complianceNote} This remains research and simulation for education, not an instruction to trade.`,
  });
}

function coerceAdvocateArgument(stance: "bull" | "bear", value: unknown): AdvocateSpeech["arguments"][number] {
  const record = normalizeRecord(value);
  const claim = nonEmptyString(record.claim, `${stanceLabel(stance)} case requires a specific, testable claim.`);
  return {
    stance,
    claim,
    plainLanguage: nonEmptyString(record.plainLanguage, claim),
    evidenceRefs: stringArray(record.evidenceRefs),
    counterEvidenceRefs: stringArray(record.counterEvidenceRefs),
    assumption: nonEmptyString(record.assumption, "The evidence remains relevant to the user's current question."),
    confidence: coerceConfidence(record.confidence),
    vulnerability: nonEmptyString(record.vulnerability, "New evidence that weakens the assumption would reduce confidence in this argument."),
  };
}

function judgeNarrative(value: unknown, fallback: string): string {
  return neutralizeJudgeNarrative(nonEmptyString(value, fallback), fallback);
}

function uniqueDebateAgents(...agentLists: DebateAgent[][]): DebateAgent[] {
  return [...new Set(agentLists.flat())];
}

function debateAgentsFrom(value: unknown): DebateAgent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const parsed = DebateAgentSchema.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });
}

function parseEnum<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {};
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArray(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return values.map((item) => String(item).trim()).filter(Boolean);
}

function coerceConfidence(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : 0.35;
}

function stanceLabel(stance: DebateStance): string {
  return stance === "bull" ? "Bull" : "Bear";
}

function includesResearchAndSimulation(value: string): boolean {
  return /\bresearch\b/iu.test(value) && /\bsimulation\b/iu.test(value);
}
