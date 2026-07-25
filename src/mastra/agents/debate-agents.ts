import { Agent } from "@mastra/core/agent";
import { z } from "zod";

import { getDeepSeekModelConfig } from "@/server/extensions/advisor/model-config";
import {
  type AdvocateSpeech,
  type DebateJudgement,
  type DebateRoundPlan,
} from "@/server/extensions/debate/contracts";
import {
  AdvocateSpeechOutputSchema,
  DebateJudgementOutputSchema,
  DebateRoundPlanOutputSchema,
  coerceAdvocateSpeech,
  coerceDebateJudgement,
  coerceDebateRoundPlan,
} from "./debate-coercion";

export {
  coerceAdvocateSpeech,
  coerceDebateJudgement,
  coerceDebateRoundPlan,
} from "./debate-coercion";

type DebateAgents = {
  orchestrator: Agent;
  bull: Agent;
  bear: Agent;
  judge: Agent;
};

const ORCHESTRATOR_INSTRUCTIONS = [
  "You orchestrate a financial-learning debate for a user.",
  "Use the LLM's own judgment to infer the user's debate role and intent from the full prompt. Do not use keyword, regex, or fixed routing rules.",
  "Choose the single most valuable round focus, the agents needed, and a useful speaking order based on the evidence board and the user's question.",
  "Always include evidence, bull, bear, and judge so the user receives a balanced, teachable round.",
  "Include chief_advisor in requiredAgents only when the user explicitly asks for a final action plan, simulated recommendation, recommendation card, or publication-gate conclusion. Never place chief_advisor in speakingOrder.",
  "Treat the prompt's evidence board as shared context. Do not invent facts, current prices, holdings, or research results.",
  "Return one JSON object only with userDebateRole, userIntent, motion, roundFocus, requiredAgents, speakingOrder, needsFreshData, and reasonForFocus.",
];

const JUDGE_INSTRUCTIONS = [
  "You are a neutral, teaching-oriented debate judge for novice investors.",
  "Use the user's claim and the shared evidence board in the prompt. Summarize what the user is claiming, then name the strongest bull and bear evidence and how directly each response addressed the user.",
  "Explain the evidence tilt without declaring a final winner. State why the judgement is not final and offer one to three concrete next research prompts.",
  "Never convert an evidence edge into a buy, sell, hold, trade, or portfolio command. Do not fabricate facts.",
  "Your compliance note must say this is research and simulation for education, not individualized investment advice or an instruction to trade.",
  "Return one JSON object only with userClaim, bullStrongestPoint, bearStrongestPoint, keyDisagreement, responseQuality, evidenceTilt, confidence, whyNotFinal, suggestedNextPrompts, and complianceNote.",
];

export function createDebateAgents(): DebateAgents {
  return {
    orchestrator: debateAgent("debate-orchestrator", "Debate Orchestrator", ORCHESTRATOR_INSTRUCTIONS, 900),
    bull: debateAgent("debate-bull-advocate", "Bull Advocate", advocateInstructions("bull"), 1_100),
    bear: debateAgent("debate-bear-advocate", "Bear Advocate", advocateInstructions("bear"), 1_100),
    judge: debateAgent("debate-judge", "Debate Judge", JUDGE_INSTRUCTIONS, 1_000),
  };
}

export async function runDebateOrchestrator(prompt: string): Promise<DebateRoundPlan> {
  const { orchestrator } = createDebateAgents();
  return runStructuredDebateAgent(orchestrator, prompt, DebateRoundPlanOutputSchema, coerceDebateRoundPlan, "DEBATE_ORCHESTRATOR");
}

export async function runDebateAdvocate(stance: "bull" | "bear", prompt: string): Promise<AdvocateSpeech> {
  const agents = createDebateAgents();
  return runStructuredDebateAgent(
    stance === "bull" ? agents.bull : agents.bear,
    prompt,
    AdvocateSpeechOutputSchema,
    (value) => coerceAdvocateSpeech(stance, value),
    `DEBATE_${stance.toUpperCase()}`,
  );
}

export async function runDebateJudge(prompt: string): Promise<DebateJudgement> {
  const { judge } = createDebateAgents();
  return runStructuredDebateAgent(judge, prompt, DebateJudgementOutputSchema, coerceDebateJudgement, "DEBATE_JUDGE");
}

export async function retryStructuredAttempt<T>(attempt: (attemptIndex: number) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
    try {
      return await attempt(attemptIndex);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function debateAgent(id: string, name: string, instructions: string[], maxOutputTokens: number): Agent {
  return new Agent({
    id,
    name,
    description: `${name} produces a structured contribution to a balanced evidence debate.`,
    model: getDeepSeekModelConfig(),
    defaultOptions: { maxSteps: 1, modelSettings: { maxOutputTokens, temperature: 0.2 } },
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
  return retryStructuredAttempt(async (attemptIndex) => {
    const retryInstruction = attemptIndex === 0
      ? ""
      : "\n\nThis is a real retry. Return one complete JSON object matching the requested fields only, with no Markdown or explanatory wrapper.";
    const modelObject = await streamModelObject(agent, `${prompt}${retryInstruction}`, schema);
    if (!hasStructuredContent(modelObject)) throw new Error(`MODEL_OUTPUT_EMPTY:${label}`);
    return coerce(modelObject);
  });
}

async function streamModelObject<T extends object>(agent: Agent, prompt: string, schema: z.ZodType<T>): Promise<T> {
  const stream = await agent.stream(prompt, {
    // The production OpenAI-compatible gateway does not reliably support
    // native response_format JSON schemas. Keep the same prompt-injection
    // path used by the working Chief Advisor agents.
    structuredOutput: { schema, jsonPromptInjection: "system" },
    maxSteps: 1,
    modelSettings: { maxOutputTokens: 1_100, temperature: 0.2 },
  });
  let latestPartial: Partial<T> = {};
  if (stream.objectStream) {
    for await (const partial of stream.objectStream) {
      if (partial && typeof partial === "object") {
        latestPartial = { ...latestPartial, ...(partial as Partial<T>) };
      }
    }
  }
  const result = await stream.object.catch(() => undefined);
  if (result && typeof result === "object") return result as T;
  if (Object.keys(latestPartial).length > 0) return latestPartial as T;
  throw new Error("MODEL_OUTPUT_EMPTY");
}

function hasStructuredContent(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}
