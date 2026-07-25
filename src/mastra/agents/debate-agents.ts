/* eslint-disable max-lines */
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
  "Return one concise JSON object only with userDebateRole, userIntent, motion, roundFocus, requiredAgents, speakingOrder, needsFreshData, and reasonForFocus.",
];

const JUDGE_INSTRUCTIONS = [
  "You are a neutral, teaching-oriented debate judge for novice investors.",
  "Use the user's claim and the shared evidence board in the prompt. Summarize what the user is claiming, then name the strongest bull and bear evidence and how directly each response addressed the user.",
  "Explain the evidence tilt without declaring a final winner. State why the judgement is not final and offer one to three concrete next research prompts.",
  "Never convert an evidence edge into a buy, sell, hold, trade, or portfolio command. Do not fabricate facts.",
  "Your compliance note must say this is research and simulation for education, not individualized investment advice or an instruction to trade.",
  "Return one concise JSON object only with userClaim, bullStrongestPoint, bearStrongestPoint, keyDisagreement, responseQuality, evidenceTilt, confidence, whyNotFinal, suggestedNextPrompts, and complianceNote.",
];
const DEBATE_AGENT_TIMEOUT_MS = 45_000;

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
  try {
    return await runStructuredDebateAgent(orchestrator, prompt, DebateRoundPlanOutputSchema, coerceDebateRoundPlan, "DEBATE_ORCHESTRATOR");
  } catch {
    return coerceDebateRoundPlan({});
  }
}

export async function runDebateAdvocate(stance: "bull" | "bear", prompt: string): Promise<AdvocateSpeech> {
  const agents = createDebateAgents();
  const agent = stance === "bull" ? agents.bull : agents.bear;
  try {
    return await runStructuredDebateAgent(
      agent,
      prompt,
      AdvocateSpeechOutputSchema,
      (value) => coerceAdvocateSpeech(stance, value),
      `DEBATE_${stance.toUpperCase()}`,
    );
  } catch {
    try {
      const text = await runPlainTextAgent(agent, plainTextAdvocatePrompt(stance, prompt), 700);
      if (text) return coerceAdvocateSpeech(stance, advocateFallbackInput(stance, text));
    } catch {
      // The final coercion below keeps the round usable without inventing a claim.
    }
    return coerceAdvocateSpeech(stance, {});
  }
}

export async function runDebateJudge(prompt: string): Promise<DebateJudgement> {
  const { judge } = createDebateAgents();
  try {
    return await runStructuredDebateAgent(judge, prompt, DebateJudgementOutputSchema, coerceDebateJudgement, "DEBATE_JUDGE");
  } catch {
    try {
      const text = await runPlainTextAgent(judge, plainTextJudgePrompt(prompt), 600);
      if (text) return coerceDebateJudgement({
        keyDisagreement: text,
        whyNotFinal: text,
        suggestedNextPrompts: ["请补充能改变当前判断的最新证据。"],
      });
    } catch {
      // The final coercion below keeps the round explicitly non-final.
    }
    return coerceDebateJudgement({});
  }
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
    "Return one concise JSON object only with stance, headline, directResponseToUser, arguments, strongestAttackOnOpponent, admittedWeakness, questionForOpponent, plainLanguageSummary, and suggestedUserFollowUp. Use one or two arguments, and keep each text field brief.",
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
    const outputTokens = label === "DEBATE_BULL" || label === "DEBATE_BEAR"
      ? 1_800
      : label === "DEBATE_JUDGE"
        ? 1_400
        : 1_000;
    const modelObject = await streamModelObject(agent, `${prompt}${retryInstruction}`, schema, outputTokens);
    if (!hasStructuredContent(modelObject)) throw new Error(`MODEL_OUTPUT_EMPTY:${label}`);
    return coerce(modelObject);
  });
}

async function streamModelObject<T extends object>(
  agent: Agent,
  prompt: string,
  schema: z.ZodType<T>,
  maxOutputTokens: number,
): Promise<T> {
  const controller = new AbortController();
  try {
    const stream = await withTimeout(
      agent.stream(prompt, {
        // The production OpenAI-compatible gateway does not reliably support
        // native response_format JSON schemas. Keep the same prompt-injection
        // path used by the working Chief Advisor agents.
        structuredOutput: { schema, jsonPromptInjection: "system" },
        maxSteps: 1,
        abortSignal: controller.signal,
        modelSettings: { maxOutputTokens, temperature: 0.2 },
      }),
      DEBATE_AGENT_TIMEOUT_MS,
      controller,
    );
    let latestPartial: Partial<T> = {};
    let streamError: unknown;
    if (stream.objectStream) {
      try {
        await withTimeout((async () => {
          for await (const partial of stream.objectStream!) {
            if (partial && typeof partial === "object") {
              latestPartial = { ...latestPartial, ...(partial as Partial<T>) };
            }
          }
        })(), DEBATE_AGENT_TIMEOUT_MS, controller);
      } catch (error) {
        streamError = error;
      }
    }
    // Once the stream has failed, the final object promise may never settle.
    // The partial object is still enough for the coercion layer to produce a
    // complete, explicitly cautious debate contribution.
    if (streamError && Object.keys(latestPartial).length > 0) return latestPartial as T;
    if (streamError instanceof Error) throw streamError;
    let result: unknown;
    try {
      result = await withTimeout(stream.object, DEBATE_AGENT_TIMEOUT_MS, controller);
    } catch (error) {
      streamError ??= error;
    }
    if (result && typeof result === "object") return result as T;
    if (Object.keys(latestPartial).length > 0) return latestPartial as T;
    if (streamError instanceof Error) throw streamError;
    throw new Error("MODEL_OUTPUT_EMPTY");
  } finally {
    controller.abort();
  }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, controller: AbortController): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new Error("MODEL_OUTPUT_TIMEOUT"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function runPlainTextAgent(agent: Agent, prompt: string, maxOutputTokens: number): Promise<string> {
  const controller = new AbortController();
  const output = await withTimeout(agent.generate(prompt, {
    maxSteps: 1,
    abortSignal: controller.signal,
    modelSettings: { maxOutputTokens, temperature: 0.2 },
  }), 30_000, controller);
  return typeof output.text === "string" ? output.text.trim().slice(0, 1_200) : "";
}

function plainTextAdvocatePrompt(stance: "bull" | "bear", prompt: string): string {
  return [
    prompt,
    `结构化输出没有完成。请直接作为${stance === "bull" ? "看多" : "看空"}方，用中文写一段不超过 120 字的公开观点。`,
    "只写基于共同证据的观点、一个主要依据和一个不确定性，不要 JSON、不要 Markdown、不要交易指令。",
  ].join("\n");
}

function plainTextJudgePrompt(prompt: string): string {
  return [
    prompt,
    "结构化输出没有完成。请直接用中文写一段不超过 120 字的裁判总结。",
    "说明双方最关键的分歧和为什么暂时不能下最终结论，不要 JSON、不要 Markdown、不要交易指令。",
  ].join("\n");
}

function advocateFallbackInput(stance: "bull" | "bear", text: string): Record<string, unknown> {
  const label = stance === "bull" ? "看多方简要观点" : "看空方简要观点";
  return {
    headline: label,
    directResponseToUser: text,
    arguments: [{
      claim: text,
      plainLanguage: text,
      assumption: "该观点依赖共同证据仍然有效。",
      vulnerability: "如果共同证据变化，该观点需要重新检验。",
    }],
    strongestAttackOnOpponent: "请对照共同证据检查对方的核心假设。",
    admittedWeakness: "当前只完成了简要观点，仍需要完整结构化证据。",
    questionForOpponent: "哪条共同证据最可能推翻你的判断？",
    plainLanguageSummary: text,
    suggestedUserFollowUp: "请继续追问支持和反驳这一观点的证据。",
  };
}

function hasStructuredContent(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}
