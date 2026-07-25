import { Agent } from "@mastra/core/agent";
import { z } from "zod";

import { getDeepSeekModelConfig } from "@/server/extensions/advisor/model-config";
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

const REQUIRED_DEBATE_AGENTS = ["evidence", "bull", "bear", "judge"] as const;
const DEFAULT_SPEAKING_ORDER: DebateAgent[] = ["evidence", "bull", "bear", "judge"];

const DebateRoundPlanOutputSchema = z.object({
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

const AdvocateSpeechOutputSchema = z.object({
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

const DebateJudgementOutputSchema = z.object({
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

type DebateAgents = {
  orchestrator: Agent;
  bull: Agent;
  bear: Agent;
  judge: Agent;
};

export function createDebateAgents(): DebateAgents {
  return {
    orchestrator: debateAgent(
      "debate-orchestrator",
      "Debate Orchestrator",
      [
        "You orchestrate a financial-learning debate for a user.",
        "Use the LLM's own judgment to infer the user's debate role and intent from the full prompt. Do not use keyword, regex, or fixed routing rules.",
        "Choose the single most valuable round focus, the agents needed, and a useful speaking order based on the evidence board and the user's question.",
        "Always include evidence, bull, bear, and judge so the user receives a balanced, teachable round.",
        "Treat the prompt's evidence board as shared context. Do not invent facts, current prices, holdings, or research results.",
        "Return one JSON object only with userDebateRole, userIntent, motion, roundFocus, requiredAgents, speakingOrder, needsFreshData, and reasonForFocus.",
      ],
      900,
    ),
    bull: debateAgent(
      "debate-bull-advocate",
      "Bull Advocate",
      advocateInstructions("bull"),
      1_100,
    ),
    bear: debateAgent(
      "debate-bear-advocate",
      "Bear Advocate",
      advocateInstructions("bear"),
      1_100,
    ),
    judge: debateAgent(
      "debate-judge",
      "Debate Judge",
      [
        "You are a neutral, teaching-oriented debate judge for novice investors.",
        "Use the user's claim and the shared evidence board in the prompt. Summarize what the user is claiming, then name the strongest bull and bear evidence and how directly each response addressed the user.",
        "Explain the evidence tilt without declaring a final winner. State why the judgement is not final and offer one to three concrete next research prompts.",
        "Never convert an evidence edge into a buy, sell, hold, trade, or portfolio command. Do not fabricate facts.",
        "Your compliance note must say this is research and simulation for education, not individualized investment advice or an instruction to trade.",
        "Return one JSON object only with userClaim, bullStrongestPoint, bearStrongestPoint, keyDisagreement, responseQuality, evidenceTilt, confidence, whyNotFinal, suggestedNextPrompts, and complianceNote.",
      ],
      1_000,
    ),
  };
}

export async function runDebateOrchestrator(prompt: string): Promise<DebateRoundPlan> {
  const { orchestrator } = createDebateAgents();
  return runStructuredDebateAgent(
    orchestrator,
    prompt,
    DebateRoundPlanOutputSchema,
    coerceDebateRoundPlan,
    "DEBATE_ORCHESTRATOR",
  );
}

export async function runDebateAdvocate(stance: "bull" | "bear", prompt: string): Promise<AdvocateSpeech> {
  const agents = createDebateAgents();
  const agent = stance === "bull" ? agents.bull : agents.bear;
  return runStructuredDebateAgent(
    agent,
    prompt,
    AdvocateSpeechOutputSchema,
    (value) => coerceAdvocateSpeech(stance, value),
    `DEBATE_${stance.toUpperCase()}`,
  );
}

export async function runDebateJudge(prompt: string): Promise<DebateJudgement> {
  const { judge } = createDebateAgents();
  return runStructuredDebateAgent(
    judge,
    prompt,
    DebateJudgementOutputSchema,
    coerceDebateJudgement,
    "DEBATE_JUDGE",
  );
}

export function coerceDebateRoundPlan(value: unknown): DebateRoundPlan {
  const record = normalizeRecord(value);
  const speakingOrder = debateAgentsFrom(record.speakingOrder);
  const requiredAgents = uniqueDebateAgents(
    debateAgentsFrom(record.requiredAgents),
    speakingOrder,
    [...REQUIRED_DEBATE_AGENTS],
  );

  return DebateRoundPlanSchema.parse({
    userDebateRole: parseEnum(DebateUserRoleSchema, record.userDebateRole) ?? "neutral",
    userIntent: parseEnum(DebateUserIntentSchema, record.userIntent) ?? "ask_both",
    motion: nonEmptyString(record.motion, "Examine the user's claim using the available evidence."),
    roundFocus: nonEmptyString(record.roundFocus, "Compare the strongest evidence and unresolved assumptions on both sides."),
    requiredAgents,
    speakingOrder: speakingOrder.length ? speakingOrder : DEFAULT_SPEAKING_ORDER,
    needsFreshData: typeof record.needsFreshData === "boolean" ? record.needsFreshData : false,
    reasonForFocus: nonEmptyString(record.reasonForFocus, "The available evidence needs a balanced adversarial review."),
  });
}

export function coerceAdvocateSpeech(stance: "bull" | "bear", value: unknown): AdvocateSpeech {
  const record = normalizeRecord(value);
  const argumentsFromModel = Array.isArray(record.arguments) ? record.arguments.slice(0, 3) : [];
  const argumentsForStance = argumentsFromModel
    .map((argument) => coerceAdvocateArgument(stance, argument))
    .filter((argument): argument is AdvocateSpeech["arguments"][number] => Boolean(argument));

  return AdvocateSpeechSchema.parse({
    stance,
    headline: nonEmptyString(record.headline, `${stanceLabel(stance)} case: test the evidence before accepting the thesis.`),
    directResponseToUser: nonEmptyString(record.directResponseToUser, "Your claim deserves a direct comparison of the available evidence and its limitations."),
    arguments: argumentsForStance.length ? argumentsForStance : [coerceAdvocateArgument(stance, {})],
    strongestAttackOnOpponent: nonEmptyString(
      record.strongestAttackOnOpponent,
      "The opposing case must explain which evidence would invalidate its core assumption.",
    ),
    admittedWeakness: nonEmptyString(
      record.admittedWeakness,
      "This case remains vulnerable to evidence that the central assumption does not hold.",
    ),
    questionForOpponent: nonEmptyString(
      record.questionForOpponent,
      "Which specific evidence would most directly challenge your conclusion?",
    ),
    plainLanguageSummary: nonEmptyString(
      record.plainLanguageSummary,
      "This is one side of the debate, so its assumptions and counter-evidence still need scrutiny.",
    ),
    suggestedUserFollowUp: nonEmptyString(
      record.suggestedUserFollowUp,
      "Ask for the strongest evidence against this case and what would change the conclusion.",
    ),
  });
}

export function coerceDebateJudgement(value: unknown): DebateJudgement {
  const record = normalizeRecord(value);
  const responseQuality = normalizeRecord(record.responseQuality);
  const bullStrongestPointFallback = "The bull case did not provide a complete strongest point, so the evidence should be reviewed directly.";
  const bearStrongestPointFallback = "The bear case did not provide a complete strongest point, so the evidence should be reviewed directly.";
  const keyDisagreementFallback = "The key disagreement is whether the available evidence supports the claim strongly enough.";
  const whyNotFinalFallback = "The evidence and assumptions remain incomplete, so this discussion cannot settle the question.";
  const suggestedPromptFallback = "Ask for fresh research that could change the current conclusion.";
  const complianceNoteFallback = "This is research and simulation for education, not individualized investment advice or an instruction to trade.";
  const suggestedNextPrompts = stringArray(record.suggestedNextPrompts)
    .slice(0, 3)
    .map((prompt) => neutralizeJudgeNarrative(prompt, suggestedPromptFallback));
  const complianceNote = neutralizeJudgeNarrative(nonEmptyString(
    record.complianceNote,
    complianceNoteFallback,
  ), complianceNoteFallback);

  return DebateJudgementSchema.parse({
    userClaim: nonEmptyString(record.userClaim, "The user's claim needs a balanced evidence review."),
    bullStrongestPoint: neutralizeJudgeNarrative(nonEmptyString(
      record.bullStrongestPoint,
      bullStrongestPointFallback,
    ), bullStrongestPointFallback),
    bearStrongestPoint: neutralizeJudgeNarrative(nonEmptyString(
      record.bearStrongestPoint,
      bearStrongestPointFallback,
    ), bearStrongestPointFallback),
    keyDisagreement: neutralizeJudgeNarrative(nonEmptyString(
      record.keyDisagreement,
      keyDisagreementFallback,
    ), keyDisagreementFallback),
    responseQuality: {
      bull: parseEnum(DebateResponseQualitySchema, responseQuality.bull) ?? "not_applicable",
      bear: parseEnum(DebateResponseQualitySchema, responseQuality.bear) ?? "not_applicable",
    },
    evidenceTilt: parseEnum(DebateEvidenceTiltSchema, record.evidenceTilt) ?? "insufficient_evidence",
    confidence: coerceConfidence(record.confidence),
    whyNotFinal: neutralizeJudgeNarrative(nonEmptyString(
      record.whyNotFinal,
      whyNotFinalFallback,
    ), whyNotFinalFallback),
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

function debateAgent(id: string, name: string, instructions: string[], maxOutputTokens: number): Agent {
  return new Agent({
    id,
    name,
    description: `${name} produces a structured contribution to a balanced evidence debate.`,
    model: getDeepSeekModelConfig(),
    defaultOptions: {
      maxSteps: 1,
      modelSettings: { maxOutputTokens, temperature: 0.2 },
    },
    instructions: instructions.join("\n"),
  });
}

function advocateInstructions(stance: "bull" | "bear"): string[] {
  return [
    `You are the ${stance} advocate in a financial-learning debate.`,
    "The prompt contains the user's question and the same evidence board seen by every advocate. Respond directly to the user using that context, not invented facts.",
    `Make the strongest good-faith ${stance} case while pressure-testing the opponent's strongest evidence.`,
    "State at least one real weakness in your own case. Do not hide uncertainty or present a weak opponent as a strawman.",
    "Do not give direct trading commands, personalized investment advice, or claims of current facts not present in the evidence board.",
    "Return one JSON object only with stance, headline, directResponseToUser, arguments, strongestAttackOnOpponent, admittedWeakness, questionForOpponent, plainLanguageSummary, and suggestedUserFollowUp.",
  ];
}

async function runStructuredDebateAgent<T extends object, TResult>(
  agent: Agent,
  prompt: string,
  schema: z.ZodType<T>,
  coerce: (value: unknown) => TResult,
  label: string,
): Promise<TResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const retryInstruction = attempt === 0
        ? ""
        : "\n\nThis is a real retry. Return one complete JSON object matching the requested fields only, with no Markdown or explanatory wrapper.";
      const modelObject = await streamModelObject(agent, `${prompt}${retryInstruction}`, schema);
      if (!hasStructuredContent(modelObject)) throw new Error(`MODEL_OUTPUT_EMPTY:${label}`);
      return coerce(modelObject);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`MODEL_OUTPUT_EMPTY:${label}`);
}

async function streamModelObject<T extends object>(agent: Agent, prompt: string, schema: z.ZodType<T>): Promise<T> {
  const stream = await agent.stream(prompt, {
    structuredOutput: { schema },
    maxSteps: 1,
    modelSettings: { maxOutputTokens: 1_100, temperature: 0.2 },
  });
  if (stream.objectStream) {
    for await (const _partial of stream.objectStream) {
      // Consume partial structured output so the completed object resolves consistently.
    }
  }
  const result = await stream.object;
  if (!result || typeof result !== "object") throw new Error("MODEL_OUTPUT_EMPTY");
  return result as T;
}

function coerceAdvocateArgument(
  stance: "bull" | "bear",
  value: unknown,
): AdvocateSpeech["arguments"][number] {
  const record = normalizeRecord(value);
  const claim = nonEmptyString(record.claim, `${stanceLabel(stance)} case requires a specific, testable claim.`);
  return {
    stance,
    claim,
    plainLanguage: nonEmptyString(record.plainLanguage, claim),
    evidenceRefs: stringArray(record.evidenceRefs),
    counterEvidenceRefs: Array.isArray(record.counterEvidenceRefs)
      ? stringArray(record.counterEvidenceRefs)
      : ["No specific counter-evidence was supplied; verify this risk with fresh research."],
    assumption: nonEmptyString(record.assumption, "The evidence remains relevant to the user's current question."),
    confidence: coerceConfidence(record.confidence),
    vulnerability: nonEmptyString(
      record.vulnerability,
      "New evidence that weakens the assumption would reduce confidence in this argument.",
    ),
  };
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

function hasStructuredContent(value: unknown): value is Record<string, unknown> {
  return isPlainRecord(value) && Object.keys(value).length > 0;
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
  if (!Number.isFinite(numeric)) return 0.35;
  return Math.min(1, Math.max(0, numeric));
}

function stanceLabel(stance: DebateStance): string {
  return stance === "bull" ? "Bull" : "Bear";
}

function includesResearchAndSimulation(value: string): boolean {
  return /\bresearch\b/iu.test(value) && /\bsimulation\b/iu.test(value);
}

function neutralizeJudgeNarrative(value: string, fallback: string): string {
  return hasImperativeTradeCommand(value) ? fallback : value;
}

function hasImperativeTradeCommand(value: string): boolean {
  return [
    /\b(?:buy|sell)\s+now\b/iu,
    /\b(?:buy|sell)\s+(?:(?:all|some|your|the)\s+)?(?:[A-Za-z0-9.$'-]+\s+){0,4}now\b/iu,
    /\b(?:immediately|now)\s+(?:buy|sell)\b/iu,
    /\b(?:must|should)\s+(?:buy|sell)\b/iu,
    /\b(?:must|should)\s+(?:add(?:\s+to)?|reduce)\s+(?:your\s+)?(?:position|holdings?)\b/iu,
    /(?:立即|马上)\s*(?:买入|卖出)/u,
    /(?:必须|应该)\s*(?:买入|卖出|加仓|减仓)/u,
  ].some((pattern) => pattern.test(value));
}
