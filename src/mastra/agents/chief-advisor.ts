/* eslint-disable max-lines */
import { Agent } from "@mastra/core/agent";
import { z } from "zod";

import { getDeepSeekModelConfig } from "@/server/extensions/advisor/model-config";
import {
  AgentFindingSchema,
  AdvisorDecisionSchema,
  DebateSuggestionSchema,
  type AgentFinding,
  type AdvisorDecision,
  type DebateSuggestion,
} from "@/server/extensions/advisor/professional-contracts";

const ChiefAgentFindingSchema = z.object({
  agent: AgentFindingSchema.shape.agent.optional(),
  conclusion: z.string().optional(),
  supportEvidence: z.array(z.string()).optional(),
  counterEvidence: z.array(z.string()).optional(),
  missingInformation: z.array(z.string()).optional(),
  risks: z.array(z.string()).optional(),
  confidence: z.number().optional(),
  needsAnotherAgent: z.boolean().optional(),
  suggestedNextAgent: AgentFindingSchema.shape.suggestedNextAgent.nullable().optional(),
});

type ChiefAgentFinding = z.infer<typeof ChiefAgentFindingSchema>;

export type ChiefAdvisorPromptContext = {
  profile?: Record<string, unknown> | null;
  goals?: unknown;
  holdings?: unknown;
  portfolioSnapshot?: Record<string, unknown> | null;
  instruments?: unknown;
  candidates?: unknown;
  targetInstrument?: unknown;
  marketData?: unknown;
  semanticTools?: unknown;
  conversationMemory?: unknown;
  knownFacts?: unknown;
  missingInformation?: unknown;
  workflow?: string;
  [key: string]: unknown;
};

const ChiefAdvisorDecisionSchema = AdvisorDecisionSchema;

export type ChiefAdvisorDecisionIntegrity = {
  complete: boolean;
  defaultedFields: string[];
  reasons: string[];
};

export type ChiefAdvisorResult = {
  decision: AdvisorDecision;
  decisionIntegrity: ChiefAdvisorDecisionIntegrity;
  findings: AgentFinding[];
  delegatedAgents: AgentFinding["agent"][];
  fallbackAgents: AgentFinding["agent"][];
};

export type ChiefAdvisorConversationResult = {
  answer: string;
  provider: "CHIEF_ADVISOR";
};

export type ChiefAdvisorScreeningResult = {
  answer: string;
  provider: "CHIEF_ADVISOR";
};

export type ChiefAdvisorStreamEvent =
  | { type: "agent.chunk"; agent: AgentFinding["agent"]; text: string }
  | { type: "agent.object"; agent: AgentFinding["agent"]; partial: Partial<AgentFinding> }
  | { type: "decision.chunk"; text: string }
  | { type: "decision.object"; partial: Partial<AdvisorDecision> };

export function createChiefAdvisorAgent() {
  return new Agent({
    id: "professional-chief-advisor",
    name: "Chief Advisor",
    description: "根据问题风险动态委派画像、研究、组合风险、建议和合规角色。",
    model: getDeepSeekModelConfig(),
    // Specialists are executed explicitly above. The chief only synthesizes
    // their persisted findings, so it must not start a second delegation loop.
    defaultOptions: { maxSteps: 1, modelSettings: { maxOutputTokens: 1_600, temperature: 0.1 } },
    instructions: [
      "你是 Money Whisperer 唯一的 Chief Advisor，也是真正面向用户的理财顾问；你要直接回答用户当前追问，并按复杂度动态委派，不使用固定通用工作流。",
      "服务端可能提供显式结构化顾问上下文，包括用户画像、目标、持仓、现金、会话记忆和已知事实；这些是已知信息，禁止重复追问。",
      "只有关键事实确实缺失且会改变结论时才追问；已知可投资金额、期限、目标、回撤边界或方向偏好时，应继续解释、资金分层、组合诊断、风险复核或合规建议。",
      "普通理财咨询不等于必须立刻给具体标的；但也不能只说先分层。你要基于已知画像给出可执行的解释、方案边界、诊断步骤和下一步选择。",
      "涉及买入、卖出、加仓、减仓时必须委派 research、risk、recommendation、compliance。",
      "专业角色只返回可展示的结构化结论，不得输出隐藏思维链。",
      "服务端提供的计算、行情新鲜度和持仓事实不可被模型改写；LATEST_TRADING_DAY 是经官方交易日历确认的最近正式收盘数据，不等于过期。",
      "dry-run、过期数据、fixture 或模型故障不能形成 ACTIVE 建议。",
      "没有反方证据、组合影响或合规批准时必须降级或阻断。",
      "supportEvidence 要写成可展示的多方支持观点，counterEvidence 要写成可展示的空方质疑观点；两边都必须基于服务端事实和上游 Agent 发现。",
      "任何结果仅用于模拟，不连接券商，不创建真实订单。",
      "当任务明确标记为普通理财顾问对话时，直接用自然中文回应，不输出 AdvisorDecision、建议状态、建议动作或 debateSuggestion。",
      "最终决策必须额外输出 debateSuggestion：判断当前问题是否适合让用户进入多空 Battle。只有存在清晰、可比较的观点或行动分歧时 recommended 才为 true；预算整理、资料解释、画像建档或缺少明确议题时为 false。motion 要写成小白能理解的具体辩题，reason 说明为什么适合或暂不适合。",
    ].join("\n"),
  });
}

export async function runChiefAdvisorConversation(input: {
  question: string;
  conversationMessages?: string[];
  context?: ChiefAdvisorPromptContext;
}): Promise<ChiefAdvisorConversationResult> {
  const chief = createChiefAdvisorAgent();
  const prompt = buildAdvisorPrompt(chiefConversationPrompt(input.question, input.conversationMessages ?? []), input.context);
  const stream = await chief.stream(prompt, {
    maxSteps: 1,
    modelSettings: { maxOutputTokens: 900, temperature: 0.3 },
  });
  let answer = "";
  for await (const chunk of stream.textStream) answer += chunk;
  const normalized = answer.trim();
  if (!normalized) throw new Error("MODEL_OUTPUT_EMPTY:CHIEF_ADVISOR_CONVERSATION");
  return { answer: normalized, provider: "CHIEF_ADVISOR" };
}

export async function runChiefAdvisorScreening(input: {
  question: string;
  context: ChiefAdvisorPromptContext & { candidates: unknown };
}): Promise<ChiefAdvisorScreeningResult> {
  const chief = createChiefAdvisorAgent();
  const prompt = buildAdvisorPrompt(chiefScreeningPrompt(input.question), input.context);
  const stream = await chief.stream(prompt, {
    maxSteps: 1,
    modelSettings: { maxOutputTokens: 1_200, temperature: 0.2 },
  });
  let answer = "";
  for await (const chunk of stream.textStream) answer += chunk;
  const normalized = answer.trim();
  if (!normalized) throw new Error("MODEL_OUTPUT_EMPTY:CHIEF_ADVISOR_SCREENING");
  return { answer: normalized, provider: "CHIEF_ADVISOR" };
}

export async function runChiefAdvisor(input: {
  prompt: string;
  context?: ChiefAdvisorPromptContext;
  requiredAgents: AgentFinding["agent"][];
  fallbackFindings?: AgentFinding[];
  onAgentStarted?: (agent: AgentFinding["agent"], label: string) => void;
  onAgentCompleted?: (finding: AgentFinding) => void;
  onAgentFailed?: (agent: AgentFinding["agent"], error: unknown) => void;
  onStreamEvent?: (event: ChiefAdvisorStreamEvent) => void;
}): Promise<ChiefAdvisorResult> {
  const chief = createChiefAdvisorAgent();
  const findings: AgentFinding[] = [];
  const delegated = new Set<AgentFinding["agent"]>();
  const fallbackAgents = new Set<AgentFinding["agent"]>();
  const specialists = createSpecialistAgents();
  const failures: Array<{ role: AgentFinding["agent"]; error: unknown }> = [];
  const advisorPrompt = buildAdvisorPrompt(input.prompt, input.context);

  const requiredAgents = [...new Set(input.requiredAgents)];
  const runSpecialist = async (role: AgentFinding["agent"], priorFindings: AgentFinding[]): Promise<AgentFinding> => {
    const specialistAgent = specialists[role];
    const prompt = specialistPrompt(advisorPrompt, role, priorFindings, input.context);
    delegated.add(role);
    input.onAgentStarted?.(role, prompt);
    let finding: AgentFinding | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2 && !finding; attempt += 1) {
      try {
        const retryPrompt = attempt === 0
          ? prompt
          : `${prompt}\n\n这是一次真实模型重试。请忽略此前任何非 JSON 输出，只返回一个完整、可解析的 JSON 对象，不要 Markdown，不要解释文字。`;
        const modelObject = await streamModelObject(specialistAgent, retryPrompt, ChiefAgentFindingSchema, (partial) => {
          input.onStreamEvent?.({ type: "agent.object", agent: role, partial: normalizeChiefFinding(partial) });
        });
        finding = coerceModelFinding(role, modelObject);
      } catch (error) {
        lastError = error;
      }
    }
    if (!finding) {
      const fallback = input.fallbackFindings?.find((candidate) => candidate.agent === role);
      if (fallback) {
        fallbackAgents.add(role);
        input.onAgentFailed?.(role, lastError ?? new Error(`MODEL_OUTPUT_EMPTY:${role}`));
        return fallback;
      }
      throw lastError ?? new Error(`MODEL_OUTPUT_EMPTY:${role}`);
    }
    input.onAgentCompleted?.(finding);
    return finding;
  };

  const independentRoleSet = new Set<AgentFinding["agent"]>([
    "PROFILE_CONTEXT",
    "DATA_RESEARCH",
    "PORTFOLIO_RISK",
  ]);
  const independentRoles = requiredAgents.filter((role) => independentRoleSet.has(role));
  const dependentRoles = requiredAgents.filter((role) => !independentRoleSet.has(role));
  const independentResults = await Promise.all(independentRoles.map(async (role) => {
    try {
      return { role, finding: await runSpecialist(role, []) };
    } catch (error) {
      input.onAgentFailed?.(role, error);
      failures.push({ role, error });
      return null;
    }
  }));
  for (const result of independentResults) {
    if (result) findings.push(result.finding);
  }
  for (const role of dependentRoles) {
    try {
      findings.push(await runSpecialist(role, findings));
    } catch (error) {
      input.onAgentFailed?.(role, error);
      failures.push({ role, error });
    }
  }
  if (failures.length) throw new AggregateError(failures.map((failure) => failure.error), `Required model agents failed: ${failures.map((failure) => failure.role).join(",")}`);

  let modelDecision: AdvisorDecision | undefined;
  let decisionIntegrity: ChiefAdvisorDecisionIntegrity | undefined;
  let lastDecisionError: unknown;
  for (let attempt = 0; attempt < 2 && !modelDecision; attempt += 1) {
    try {
      const decisionPrompt = chiefDecisionPrompt(advisorPrompt, findings, input.context) + (attempt === 0
        ? ""
        : "\n\n这是一次真实模型重试。只返回一个完整、可解析的 AdvisorDecision JSON 对象，不要 Markdown，不要解释文字。");
      const modelObject = await streamModelObject(chief, decisionPrompt, ChiefAdvisorDecisionSchema, (partial) => {
        input.onStreamEvent?.({ type: "decision.object", partial: normalizeRecord(partial) as Partial<AdvisorDecision> });
      });
      const coerced = coerceModelDecision(modelObject);
      modelDecision = coerced.decision;
      decisionIntegrity = coerced.integrity;
    } catch (error) {
      lastDecisionError = error;
    }
  }
  if (!modelDecision || !decisionIntegrity) throw lastDecisionError ?? new Error("MODEL_OUTPUT_EMPTY:CHIEF_ADVISOR");
  const missingRequired = input.requiredAgents.filter((role) => !delegated.has(role));
  if (missingRequired.length) throw new Error(`Chief Advisor omitted mandatory agents: ${missingRequired.join(",")}`);
  return { decision: modelDecision, decisionIntegrity, findings, delegatedAgents: [...delegated], fallbackAgents: [...fallbackAgents] };
}

async function streamModelObject<T extends object>(
  agent: Agent,
  prompt: string,
  schema: z.ZodType<T>,
  onPartial: (partial: Partial<T>) => void,
): Promise<T> {
  const stream = await agent.stream(prompt, {
    structuredOutput: { schema, jsonPromptInjection: "system" },
    maxSteps: 1,
    modelSettings: { maxOutputTokens: 1_400, temperature: 0.1 },
  });
  let latestPartial: Partial<T> = {};
  if (stream.objectStream) {
    for await (const partial of stream.objectStream) {
      if (partial && typeof partial === "object") {
        latestPartial = { ...latestPartial, ...(partial as Partial<T>) };
        onPartial(latestPartial);
      }
    }
  }
  const result = await stream.object.catch(() => undefined);
  if (result && typeof result === "object") return result as T;
  if (Object.keys(latestPartial).length > 0) return latestPartial as T;
  throw new Error("MODEL_OUTPUT_EMPTY");
}

function normalizeChiefFinding(value: unknown): Partial<AgentFinding> {
  if (!isPlainRecord(value)) return {};
  const { suggestedNextAgent, ...rest } = value;
  const parsedSuggestedNextAgent = ProfessionalAgentRoleFromUnknown(suggestedNextAgent);
  return {
    ...rest,
    ...(parsedSuggestedNextAgent ? { suggestedNextAgent: parsedSuggestedNextAgent } : {}),
  } as Partial<AgentFinding>;
}

function coerceModelFinding(
  role: AgentFinding["agent"],
  value: unknown,
  streamedPartial: Partial<ChiefAgentFinding> = {},
): AgentFinding {
  const merged = {
    ...normalizeChiefFinding(streamedPartial),
    ...normalizeChiefFinding(value),
    agent: role,
  };
  const conclusion = typeof merged.conclusion === "string" ? merged.conclusion.trim() : "";
  if (!conclusion) throw new Error(`MODEL_OUTPUT_EMPTY:${role}`);
  const missingInformation = coerceStringArray(merged.missingInformation).slice(0, 12);
  const counterEvidence = coerceStringArray(merged.counterEvidence).slice(0, 3);
  const suggestedNextAgent = ProfessionalAgentRoleFromUnknown(merged.suggestedNextAgent);
  return AgentFindingSchema.parse({
    agent: role,
    conclusion,
    supportEvidence: coerceStringArray(merged.supportEvidence).slice(0, 3),
    counterEvidence: counterEvidence.length ? counterEvidence : ["市场、画像或持仓变化可能使当前结论失效"],
    missingInformation,
    risks: coerceStringArray(merged.risks).slice(0, 3),
    confidence: coerceConfidence(merged.confidence, missingInformation.length ? 0.45 : 0.7),
    needsAnotherAgent: typeof merged.needsAnotherAgent === "boolean"
      ? merged.needsAnotherAgent
      : missingInformation.length > 0 || Boolean(suggestedNextAgent),
    ...(suggestedNextAgent ? { suggestedNextAgent } : {}),
  });
}

function coerceModelDecision(
  value: unknown,
  streamedPartial: Partial<AdvisorDecision> = {},
): { decision: AdvisorDecision; integrity: ChiefAdvisorDecisionIntegrity } {
  const merged = {
    ...normalizeRecord(streamedPartial),
    ...normalizeRecord(value),
  } as Record<string, unknown>;
  const strictResult = AdvisorDecisionSchema.safeParse(merged);
  const defaultedFields = strictResult.success
    ? []
    : [...new Set(strictResult.error.issues.map((issue) => issue.path.map(String).join(".") || "decision"))];
  const integrity: ChiefAdvisorDecisionIntegrity = {
    complete: strictResult.success,
    defaultedFields,
    reasons: defaultedFields.length
      ? [`Chief Advisor 结构化输出未通过完整 schema，coercion 补全或修正字段：${defaultedFields.join(", ")}`]
      : [],
  };
  const compliance = isPlainRecord(merged.compliance) ? merged.compliance : {};
  const decision = AdvisorDecisionSchema.parse({
    action: merged.action ?? "WATCH",
    requestedDirection: merged.requestedDirection ?? "ANALYZE",
    summary: nonEmptyString(merged.summary, "模型未能形成完整结论，已按观察处理"),
    suitability: merged.suitability ?? "LOW",
    confidence: coerceConfidence(merged.confidence, 0.65),
    rationales: coerceStringArray(merged.rationales).slice(0, 3).length ? coerceStringArray(merged.rationales).slice(0, 3) : ["根据当前画像、持仓和市场证据维持观察"],
    counterEvidence: coerceStringArray(merged.counterEvidence).slice(0, 3).length ? coerceStringArray(merged.counterEvidence).slice(0, 3) : ["市场、画像或持仓变化可能使当前结论失效"],
    risks: coerceStringArray(merged.risks).slice(0, 3).length ? coerceStringArray(merged.risks).slice(0, 3) : ["模型输出不完整"],
    portfolioImpact: nonEmptyString(merged.portfolioImpact, "暂不改变组合，等待完整证据"),
    invalidationConditions: coerceStringArray(merged.invalidationConditions).slice(0, 6).length ? coerceStringArray(merged.invalidationConditions).slice(0, 6) : ["出现新的实时数据或完整风险信息"],
    debateSuggestion: coerceDebateSuggestion(merged.debateSuggestion),
    compliance: {
      approved: typeof compliance.approved === "boolean" ? compliance.approved : false,
      decision: compliance.decision ?? "DOWNGRADED",
      reason: nonEmptyString(compliance.reason, "模型输出不完整，无法通过发布门").slice(0, 500),
    },
  });
  if (!integrity.complete) {
    return {
      integrity,
      decision: {
        ...decision,
        compliance: {
          approved: false,
          decision: decision.compliance.decision === "BLOCKED" ? "BLOCKED" : "DOWNGRADED",
          reason: userFacingIncompleteDecisionReason(decision.compliance.reason),
        },
      },
    };
  }
  if (decision.compliance.decision !== "APPROVED" && decision.compliance.approved) {
    return {
      integrity,
      decision: {
        ...decision,
        compliance: { ...decision.compliance, approved: false },
      },
    };
  }
  return { decision, integrity };
}

function coerceDebateSuggestion(value: unknown): DebateSuggestion {
  const candidate = isPlainRecord(value) ? value : {};
  const recommended = candidate.recommended === true;
  return DebateSuggestionSchema.parse({
    recommended,
    motion: nonEmptyString(
      candidate.motion,
      recommended ? "当前观点是否值得继续持有或采取行动？" : "当前问题暂不适合进入多空 Battle",
    ),
    reason: nonEmptyString(
      candidate.reason,
      recommended ? "当前问题存在可比较的多空判断，适合让用户同时听取两方依据。" : "当前问题还没有形成清晰的多空议题，先完成基础信息整理更有帮助。",
    ),
  });
}

function userFacingIncompleteDecisionReason(reason: string): string {
  if (reason && !/(?:schema|coercion|rationales|counterEvidence|debateSuggestion)/iu.test(reason)) return reason;
  return "当前证据仍需进一步核验，本次结论仅供谨慎参考，不建议直接执行。";
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {};
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function coerceStringArray(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return values.map((item) => String(item).trim()).filter(Boolean);
}

function coerceConfidence(value: unknown, fallback = 0.6): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(1, Math.max(0, numeric));
}

function ProfessionalAgentRoleFromUnknown(value: unknown): AgentFinding["agent"] | undefined {
  const parsed = AgentFindingSchema.shape.agent.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function chiefConversationPrompt(question: string, conversationMessages: string[]): string {
  return [
    "当前任务是普通理财顾问对话，由 Chief Advisor 直接面对用户，不启动专业投资决策或建议卡流程。",
    `用户当前消息：${question}`,
    conversationMessages.length
      ? `最近用户消息：${JSON.stringify(conversationMessages.slice(-8))}`
      : "这是当前会话的第一条用户消息。",
    "请像面向理财小白的真人顾问一样自然回应：问候就简短问候并邀请用户说出目标；开放式问题先理解诉求，再给一小步解释或只追问一个最关键问题。",
    "不要输出建议状态、建议动作、合规结论、行情研究、组合诊断或建议卡提示；不要因为服务端提供了持仓就主动分析全部持仓。",
    "可以使用已知画像避免重复提问，但不要整段复述画像。只有用户明确提出持仓诊断、具体标的分析、买入、卖出、加仓或减仓时，才应提示进入专业分析流程。",
    "只输出给用户看的自然中文答复，不要 JSON，不要 Markdown 标题，不要描述内部 Agent 或工作流。",
  ].join("\n\n");
}

function chiefScreeningPrompt(question: string): string {
  return [
    "当前任务是受控候选池筛选。你是面向理财小白的 Chief Advisor，要基于服务端提供的候选标的和真实行情核验结果，帮助用户缩小研究范围。",
    `用户当前要求：${question}`,
    "最多给出 3 个研究候选。每个候选必须写清名称和代码、值得继续研究的原因、不适合或需要警惕的原因，以及下一步应核验什么。",
    "候选只是研究起点，不得写成确定买入、保证收益、立即建仓或绕过完整建议卡的交易指令。",
    "如果行情核验失败或数据为空，要明确说明数据限制，但仍可基于受控目录给出待核验名单；不得编造价格、涨跌幅、估值或基本面。",
    "结合用户现有持仓和画像指出集中度、偏好冲突或风险预算问题，但不要重复追问已经在结构化上下文中的信息。",
    "只输出自然中文，不要 JSON，不要内部 Agent 名、schema、coercion、英文状态码或工作流诊断。",
  ].join("\n\n");
}

function buildAdvisorPrompt(prompt: string, context?: ChiefAdvisorPromptContext): string {
  const contextLines = formatAdvisorContext(context);
  if (!contextLines.length) return prompt;
  return [
    prompt,
    "显式结构化顾问上下文如下。该上下文由服务端提供，优先级高于自然语言里的模糊表述；字段存在时视为已知事实。",
    ...contextLines,
    "上下文使用规则：禁止重复追问上述已知画像、目标、资金用途、风险边界、持仓或现金信息；只对真正缺失且会改变结论的关键事实提问。",
  ].join("\n\n");
}

function formatAdvisorContext(context?: ChiefAdvisorPromptContext): string[] {
  if (!context) return [];
  const entries: Array<[string, unknown]> = [
    ["工作模式", context.workflow],
    ["用户画像", context.profile],
    ["用户目标", context.goals],
    ["组合快照", context.portfolioSnapshot],
    ["持仓", context.holdings],
    ["自选/可交易标的", context.instruments],
    ["候选标的", context.candidates],
    ["目标标的", context.targetInstrument],
    ["行情与研究上下文", context.marketData],
    ["语义工具上下文", context.semanticTools],
    ["会话记忆", context.conversationMemory],
    ["服务端已知事实", context.knownFacts],
    ["服务端仍缺失的信息", context.missingInformation],
  ];
  const knownCoverage = describeKnownContext(context);
  return [
    `已知信息覆盖：${knownCoverage.length ? knownCoverage.join("、") : "未提供结构化画像/目标/持仓"}`,
    ...entries.flatMap(([label, value]) => typeof value === "undefined" ? [] : [`${label}：${safeJson(value)}`]),
  ];
}

function describeKnownContext(context: ChiefAdvisorPromptContext): string[] {
  const coverage: string[] = [];
  if (hasKnownFields(context.profile)) coverage.push("用户画像");
  if (hasKnownFields(context.goals)) coverage.push("目标/资金用途");
  if (hasKnownFields(context.portfolioSnapshot)) coverage.push("现金与组合快照");
  if (hasKnownFields(context.holdings)) coverage.push("持仓");
  if (hasKnownFields(context.candidates)) coverage.push("候选标的");
  if (hasKnownFields(context.targetInstrument)) coverage.push("目标标的");
  if (hasKnownFields(context.marketData)) coverage.push("行情/研究数据");
  if (hasKnownFields(context.conversationMemory)) coverage.push("会话记忆");
  if (hasKnownFields(context.knownFacts)) coverage.push("服务端已知事实");
  return coverage;
}

function hasKnownFields(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (!isPlainRecord(value)) return typeof value !== "undefined" && value !== null && value !== "";
  return Object.values(value).some((item) => {
    if (Array.isArray(item)) return item.length > 0;
    if (isPlainRecord(item)) return hasKnownFields(item);
    return typeof item !== "undefined" && item !== null && item !== "";
  });
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(String(value));
  }
}

function chiefDecisionPrompt(prompt: string, findings: AgentFinding[], context?: ChiefAdvisorPromptContext): string {
  return [
    "以下是用户问题、服务端事实和已经显式执行完成的专业子 Agent 发现。",
    "你必须基于这些发现形成 AdvisorDecision。不得覆盖服务端事实或自行计算数据年龄；服务端标记 LIVE_FRESH 或 LATEST_TRADING_DAY 时不得声称数据过期；不得在证据不足时给出 ACTIVE 交易承诺。",
    "最终 JSON 必须完整包含 action、requestedDirection、summary、suitability、confidence、rationales、counterEvidence、risks、portfolioImpact、invalidationConditions、compliance 和 debateSuggestion，不得省略字段。",
    "你是最终理财顾问，不只是流程调度器；必须回答用户当前问题，并把解释、方案、诊断、风险和合规边界整合成可展示结论。",
    "如果显式结构化顾问上下文已经包含画像、目标、资金用途、可投资金额、期限、最大回撤、方向偏好或持仓，禁止把这些列为 missingInformation，也不要再次追问。",
    context ? `已知上下文覆盖：${describeKnownContext(context).join("、") || "无"}` : "未提供额外结构化上下文。",
    prompt,
    `专业子 Agent 发现：${JSON.stringify(findings)}`,
  ].join("\n\n");
}

function createSpecialistAgents(): Record<AgentFinding["agent"], Agent> {
  return {
    PROFILE_CONTEXT: specialist("professional-profile-context", "Profile Context", "PROFILE_CONTEXT"),
    DATA_RESEARCH: specialist("professional-data-research", "Data & Research", "DATA_RESEARCH"),
    PORTFOLIO_RISK: specialist("professional-portfolio-risk", "Portfolio & Risk", "PORTFOLIO_RISK"),
    RECOMMENDATION: specialist("professional-recommendation", "Recommendation", "RECOMMENDATION"),
    COMPLIANCE_REVIEWER: specialist("professional-compliance", "Compliance Reviewer", "COMPLIANCE_REVIEWER"),
    EXPLANATION_REPORT: specialist("professional-explanation-report", "Explanation Report", "EXPLANATION_REPORT"),
  };
}

function specialistPrompt(
  prompt: string,
  role: AgentFinding["agent"],
  priorFindings: AgentFinding[],
  context?: ChiefAdvisorPromptContext,
): string {
  return [
    `当前角色：${role}`,
    "你是 Money Whisperer 的真实专业子 Agent。你必须基于服务端事实、上游角色发现和用户问题输出可展示的结构化发现。",
    "不要复述隐藏思维链；不要编造行情、持仓或用户画像；证据不足时写入 missingInformation 和 counterEvidence。",
    specialistResponsibility(role),
    context ? `已知上下文覆盖：${describeKnownContext(context).join("、") || "无"}` : "未提供额外结构化上下文。",
    "如果显式结构化顾问上下文已经给出相关信息，禁止重复追问；missingInformation 只列真正缺失且会改变本角色结论的内容。",
    `用户与服务端上下文：\n${prompt}`,
    priorFindings.length ? `已完成的上游发现：${JSON.stringify(priorFindings)}` : "暂无上游发现。",
  ].join("\n\n");
}

function specialistResponsibility(role: AgentFinding["agent"]): string {
  switch (role) {
    case "PROFILE_CONTEXT":
      return "职责：识别已知画像、目标、资金用途、期限、回撤边界和偏好；不要因为没有重新采集表单就重复询问已在上下文中的信息。";
    case "DATA_RESEARCH":
      return "职责：围绕用户当前追问确认是否需要行情、财务、估值或宏观证据；不需要外部数据的问题要明确说明 NOT_REQUIRED 的原因。";
    case "PORTFOLIO_RISK":
      return "职责：结合持仓、现金、目标和回撤边界做组合诊断、集中度、流动性、波动和情景风险复核。";
    case "RECOMMENDATION":
      return "职责：在风险和合规边界内给出可执行方案、仓位区间、观察条件或替代路径；未请求具体标的时给资金分层和配置框架。";
    case "COMPLIANCE_REVIEWER":
      return "职责：检查适当性、信息缺口、数据状态和模拟交易边界；可以降级或阻断，但要说明用户还能继续做什么。";
    case "EXPLANATION_REPORT":
      return "职责：把顾问结论解释成用户能继续决策的语言，回应追问，不要只重复流程下一步。";
  }
}

function specialist(id: string, name: string, agent: AgentFinding["agent"]) {
  return new Agent({
    id,
    name,
    description: `${name} 输出证据、反方证据、缺失信息、风险和后续角色。`,
    model: getDeepSeekModelConfig(),
    defaultOptions: { maxSteps: 1, modelSettings: { maxOutputTokens: 700, temperature: 0.1 } },
    instructions: [
      `你的角色是 ${agent}，只处理 Chief Advisor 委派的专业任务。`,
      "输出单个 JSON 对象，字段为 agent,conclusion,supportEvidence,counterEvidence,missingInformation,risks,confidence,needsAnotherAgent,suggestedNextAgent。",
      "supportEvidence 是多方支持观点，counterEvidence 是空方质疑观点；两边都要基于可展示事实，counterEvidence 至少一条，supportEvidence 和 risks 最多三条，不输出隐藏推理。",
      "证据不足时明确列入 missingInformation，降低 confidence。",
    ].join("\n"),
  });
}
