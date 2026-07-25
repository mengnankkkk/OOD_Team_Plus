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
  type DebateSpeakingAgent,
  type DebateStance,
} from "@/server/extensions/debate/contracts";
import { neutralizeTradeDirective } from "./debate-judge-safety";

const DEFAULT_DEBATE_AGENTS: DebateAgent[] = ["evidence", "bull", "bear", "judge"];
const JUDGE_FALLBACKS = {
  bull: "多方的完整论据暂未生成，请直接检查共同 evidence。",
  bear: "空方的完整论据暂未生成，请直接检查共同 evidence。",
  disagreement: "关键分歧是现有 evidence 是否足以支持用户提出的判断。",
  notFinal: "证据或关键假设仍不完整，本轮 research discussion 暂时不能下最终结论。",
  prompt: "Ask for fresh research that could change the current conclusion.",
  compliance: "This is research and simulation for education, not individualized investment advice or an instruction to trade.",
} as const;
const ADVOCATE_FALLBACKS = {
  headline: "本方观点需要结合共同 evidence 继续检验。",
  response: "现有 evidence 可以支持 research，但不能直接变成交易指令。",
  claim: "这条论据需要用共同 evidence 进一步验证。",
  plainLanguage: "简单说，本方还需要 evidence 才能得出更稳妥的判断。",
  assumption: "这条论据依赖一个需要用 research 检查的关键假设。",
  vulnerability: "如果出现新的 evidence，本方判断可能被削弱。",
  attack: "请对方说明哪些 evidence 支持其核心假设。",
  weakness: "本方仍可能受到缺失或相互冲突 research evidence 的影响。",
  question: "Which evidence could most directly weaken your conclusion?",
  summary: "这是一个 research perspective，相关假设仍需继续核验。",
  followUp: "Ask which fresh research evidence would change this side's view.",
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
  const scheduledModelAgents = debateAgentsFrom(record.speakingOrder);
  const scheduledAgents = scheduledModelAgents.filter((agent): agent is DebateSpeakingAgent => agent !== "chief_advisor");
  const modelRequiredAgents = debateAgentsFrom(record.requiredAgents);
  const requiredAgents = uniqueDebateAgents(
    DEFAULT_DEBATE_AGENTS,
    modelRequiredAgents,
    scheduledModelAgents,
  );
  const speakingOrder = completeSpeakingOrder(scheduledAgents);

  return DebateRoundPlanSchema.parse({
    userDebateRole: parseEnum(DebateUserRoleSchema, record.userDebateRole) ?? "neutral",
    userIntent: parseEnum(DebateUserIntentSchema, record.userIntent) ?? "ask_both",
    motion: nonEmptyString(record.motion, "围绕用户提出的问题比较看多与看空证据。"),
    roundFocus: nonEmptyString(record.roundFocus, "比较双方最强证据和仍未解决的关键假设。"),
    requiredAgents,
    speakingOrder,
    needsFreshData: typeof record.needsFreshData === "boolean" ? record.needsFreshData : false,
    reasonForFocus: nonEmptyString(record.reasonForFocus, "用户需要用共同证据理解双方分歧，而不是只看单一结论。"),
  });
}

export function coerceAdvocateSpeech(stance: "bull" | "bear", value: unknown): AdvocateSpeech {
  const record = normalizeRecord(value);
  const argumentsForStance = (Array.isArray(record.arguments) ? record.arguments : [])
    .slice(0, 3)
    .map((argument) => coerceAdvocateArgument(stance, argument));

  return AdvocateSpeechSchema.parse({
    stance,
    headline: advocateNarrative(record.headline, ADVOCATE_FALLBACKS.headline),
    directResponseToUser: advocateNarrative(record.directResponseToUser, ADVOCATE_FALLBACKS.response),
    arguments: argumentsForStance.length ? argumentsForStance : [coerceAdvocateArgument(stance, {})],
    strongestAttackOnOpponent: advocateNarrative(record.strongestAttackOnOpponent, ADVOCATE_FALLBACKS.attack),
    admittedWeakness: advocateNarrative(record.admittedWeakness, ADVOCATE_FALLBACKS.weakness),
    questionForOpponent: advocateNarrative(record.questionForOpponent, ADVOCATE_FALLBACKS.question),
    plainLanguageSummary: advocateNarrative(record.plainLanguageSummary, ADVOCATE_FALLBACKS.summary),
    suggestedUserFollowUp: advocateNarrative(record.suggestedUserFollowUp, ADVOCATE_FALLBACKS.followUp),
  });
}

export function coerceDebateJudgement(value: unknown): DebateJudgement {
  const record = normalizeRecord(value);
  const responseQuality = normalizeRecord(record.responseQuality);
  const suggestedNextPrompts = stringArray(record.suggestedNextPrompts)
    .slice(0, 3)
    .map((prompt) => neutralizeTradeDirective(prompt, JUDGE_FALLBACKS.prompt));
  const complianceNote = neutralizeTradeDirective(
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
  const claim = advocateNarrative(record.claim, `${stanceLabel(stance)} case: ${ADVOCATE_FALLBACKS.claim}`);
  return {
    stance,
    claim,
    plainLanguage: advocateNarrative(record.plainLanguage, ADVOCATE_FALLBACKS.plainLanguage),
    evidenceRefs: stringArray(record.evidenceRefs),
    counterEvidenceRefs: stringArray(record.counterEvidenceRefs),
    assumption: advocateNarrative(record.assumption, ADVOCATE_FALLBACKS.assumption),
    confidence: coerceConfidence(record.confidence),
    vulnerability: advocateNarrative(record.vulnerability, ADVOCATE_FALLBACKS.vulnerability),
  };
}

function judgeNarrative(value: unknown, fallback: string): string {
  return neutralizeTradeDirective(nonEmptyString(value, fallback), fallback);
}

function advocateNarrative(value: unknown, fallback: string): string {
  return neutralizeTradeDirective(nonEmptyString(value, fallback), fallback);
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

function completeSpeakingOrder(value: DebateSpeakingAgent[]): DebateSpeakingAgent[] {
  const advocates = [...new Set(value.filter((agent) => agent === "bull" || agent === "bear"))];
  if (!advocates.includes("bull")) advocates.push("bull");
  if (!advocates.includes("bear")) advocates.push("bear");
  return ["evidence", ...advocates, ...advocates, "judge"];
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
