import { Agent } from "@mastra/core/agent";
import type { ReadableStream as NodeReadableStream } from "stream/web";
import { z } from "zod";

import { getDeepSeekModelConfig } from "@/server/extensions/advisor/model-config";
import { AgentFindingSchema, AdvisorDecisionSchema, type AgentFinding, type AdvisorDecision } from "@/server/extensions/advisor/professional-contracts";

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

const ChiefAdvisorDecisionSchema = z.object({
  action: AdvisorDecisionSchema.shape.action.optional(),
  requestedDirection: AdvisorDecisionSchema.shape.requestedDirection.optional(),
  summary: z.string().optional(),
  suitability: AdvisorDecisionSchema.shape.suitability.optional(),
  confidence: z.number().optional(),
  rationales: z.array(z.string()).optional(),
  counterEvidence: z.array(z.string()).optional(),
  risks: z.array(z.string()).optional(),
  portfolioImpact: z.string().optional(),
  invalidationConditions: z.array(z.string()).optional(),
  compliance: z.object({
    approved: z.boolean().optional(),
    decision: AdvisorDecisionSchema.shape.compliance.shape.decision.optional(),
    reason: z.string().optional(),
  }).optional(),
});

type ChiefAdvisorDecision = z.infer<typeof ChiefAdvisorDecisionSchema>;

export type ChiefAdvisorResult = {
  decision: AdvisorDecision;
  findings: AgentFinding[];
  delegatedAgents: AgentFinding["agent"][];
};

export type ChiefAdvisorStreamEvent =
  | { type: "agent.chunk"; agent: AgentFinding["agent"]; text: string }
  | { type: "agent.object"; agent: AgentFinding["agent"]; partial: Partial<AgentFinding> }
  | { type: "decision.chunk"; text: string }
  | { type: "decision.object"; partial: Partial<AdvisorDecision> };

export function createChiefAdvisorAgent() {
  const profile = specialist("professional-profile-context", "Profile Context", "PROFILE_CONTEXT");
  const research = specialist("professional-data-research", "Data & Research", "DATA_RESEARCH");
  const risk = specialist("professional-portfolio-risk", "Portfolio & Risk", "PORTFOLIO_RISK");
  const recommendation = specialist("professional-recommendation", "Recommendation", "RECOMMENDATION");
  const compliance = specialist("professional-compliance", "Compliance Reviewer", "COMPLIANCE_REVIEWER");
  const explanation = specialist("professional-explanation-report", "Explanation Report", "EXPLANATION_REPORT");
  return new Agent({
    id: "professional-chief-advisor",
    name: "Chief Advisor",
    description: "根据问题风险动态委派画像、研究、组合风险、建议和合规角色。",
    model: getDeepSeekModelConfig(),
    defaultOptions: { maxSteps: 10, modelSettings: { maxOutputTokens: 1_600, temperature: 0.1 } },
    agents: { profile, research, risk, recommendation, compliance, explanation },
    instructions: [
      "你是 Money Whisperer 唯一的 Chief Advisor，按问题复杂度动态委派，不使用固定通用工作流。",
      "涉及买入、卖出、加仓、减仓时必须委派 research、risk、recommendation、compliance。",
      "专业角色只返回可展示的结构化结论，不得输出隐藏思维链。",
      "服务端提供的计算、行情新鲜度和持仓事实不可被模型改写。",
      "dry-run、过期数据、fixture 或模型故障不能形成 ACTIVE 建议。",
      "没有反方证据、组合影响或合规批准时必须降级或阻断。",
      "任何结果仅用于模拟，不连接券商，不创建真实订单。",
    ].join("\n"),
  });
}

export async function runChiefAdvisor(input: {
  prompt: string;
  requiredAgents: AgentFinding["agent"][];
  onAgentStarted?: (agent: AgentFinding["agent"], label: string) => void;
  onAgentCompleted?: (finding: AgentFinding) => void;
  onAgentFailed?: (agent: AgentFinding["agent"], error: unknown) => void;
  onStreamEvent?: (event: ChiefAdvisorStreamEvent) => void;
}): Promise<ChiefAdvisorResult> {
  const chief = createChiefAdvisorAgent();
  const findings: AgentFinding[] = [];
  const delegated = new Set<AgentFinding["agent"]>();
  const specialists = createSpecialistAgents();
  const failures: Array<{ role: AgentFinding["agent"]; error: unknown }> = [];

  for (const role of [...new Set(input.requiredAgents)]) {
    const specialistAgent = specialists[role];
    const prompt = specialistPrompt(input.prompt, role, findings);
    delegated.add(role);
    input.onAgentStarted?.(role, prompt.slice(0, 160));
    try {
      let streamedText = "";
      const stream = await specialistAgent.stream(prompt, { maxSteps: 1, modelSettings: { maxOutputTokens: 900, temperature: 0.1 } });
      const consumeText = consumeTextStream(stream.textStream, (text) => {
        streamedText += text;
        input.onStreamEvent?.({ type: "agent.chunk", agent: role, text });
      });
      const [textResult] = await Promise.allSettled([stream.text, consumeText]);
      if (textResult.status === "rejected") throw textResult.reason;
      const modelText = typeof textResult.value === "string" && textResult.value.trim() ? textResult.value : streamedText;
      const finding = coerceModelFinding(role, parseModelJson(modelText));
      findings.push(finding);
      input.onAgentCompleted?.(finding);
    } catch (error) {
      input.onAgentFailed?.(role, error);
      failures.push({ role, error });
    }
  }
  if (failures.length) throw new AggregateError(failures.map((failure) => failure.error), `Required model agents failed: ${failures.map((failure) => failure.role).join(",")}`);

  let streamedDecisionText = "";
  const decisionStream = await chief.stream(chiefDecisionPrompt(input.prompt, findings), { maxSteps: 1, modelSettings: { maxOutputTokens: 1_600, temperature: 0.1 } });
  const consumeDecisionText = consumeTextStream(decisionStream.textStream, (text) => {
    streamedDecisionText += text;
    input.onStreamEvent?.({ type: "decision.chunk", text });
  });
  const [decisionResult] = await Promise.allSettled([decisionStream.text, consumeDecisionText]);
  if (decisionResult.status === "rejected") throw decisionResult.reason;
  const modelDecisionText = typeof decisionResult.value === "string" && decisionResult.value.trim() ? decisionResult.value : streamedDecisionText;
  const missingRequired = input.requiredAgents.filter((role) => !delegated.has(role));
  if (missingRequired.length) throw new Error(`Chief Advisor omitted mandatory agents: ${missingRequired.join(",")}`);
  return { decision: coerceModelDecision(parseModelJson(modelDecisionText)), findings, delegatedAgents: [...delegated] };
}

function parseModelJson(value: string): unknown {
  const text = value.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
  if (!text) throw new Error("MODEL_OUTPUT_EMPTY");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1)) as unknown;
    throw new Error("MODEL_OUTPUT_INVALID_JSON");
  }
}

async function consumeTextStream(stream: NodeReadableStream<string>, onChunk: (text: string) => void): Promise<void> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) onChunk(value);
    }
  } finally {
    reader.releaseLock();
  }
}

async function consumeObjectStream<T extends object>(stream: NodeReadableStream<Partial<T>>, onPartial: (partial: Partial<T>) => void): Promise<void> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value && Object.keys(value).length > 0) onPartial(value);
    }
  } finally {
    reader.releaseLock();
  }
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
    counterEvidence: counterEvidence.length ? counterEvidence : ["模型未提供反方证据，发布门按证据不足保守处理"],
    missingInformation,
    risks: coerceStringArray(merged.risks).slice(0, 3),
    confidence: coerceConfidence(merged.confidence),
    needsAnotherAgent: typeof merged.needsAnotherAgent === "boolean"
      ? merged.needsAnotherAgent
      : missingInformation.length > 0 || Boolean(suggestedNextAgent),
    ...(suggestedNextAgent ? { suggestedNextAgent } : {}),
  });
}

function coerceModelDecision(value: unknown, streamedPartial: Partial<AdvisorDecision> = {}): AdvisorDecision {
  const merged = {
    ...normalizeRecord(streamedPartial),
    ...normalizeRecord(value),
  } as Record<string, unknown>;
  const compliance = isPlainRecord(merged.compliance) ? merged.compliance : {};
  return AdvisorDecisionSchema.parse({
    action: merged.action ?? "WATCH",
    requestedDirection: merged.requestedDirection ?? "ANALYZE",
    summary: nonEmptyString(merged.summary, "模型未能形成完整结论，已按观察处理"),
    suitability: merged.suitability ?? "LOW",
    confidence: coerceConfidence(merged.confidence),
    rationales: coerceStringArray(merged.rationales).slice(0, 3).length ? coerceStringArray(merged.rationales).slice(0, 3) : ["证据不足，无法形成更积极的建议"],
    counterEvidence: coerceStringArray(merged.counterEvidence).slice(0, 3).length ? coerceStringArray(merged.counterEvidence).slice(0, 3) : ["模型未提供反方证据，按保守门控处理"],
    risks: coerceStringArray(merged.risks).slice(0, 3).length ? coerceStringArray(merged.risks).slice(0, 3) : ["模型输出不完整"],
    portfolioImpact: nonEmptyString(merged.portfolioImpact, "暂不改变组合，等待完整证据"),
    invalidationConditions: coerceStringArray(merged.invalidationConditions).slice(0, 6).length ? coerceStringArray(merged.invalidationConditions).slice(0, 6) : ["出现新的实时数据或完整风险信息"],
    compliance: {
      approved: typeof compliance.approved === "boolean" ? compliance.approved : false,
      decision: compliance.decision ?? "DOWNGRADED",
      reason: nonEmptyString(compliance.reason, "模型输出不完整，无法通过发布门").slice(0, 500),
    },
  });
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

function coerceConfidence(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) return 0.35;
  return Math.min(1, Math.max(0, numeric));
}

function ProfessionalAgentRoleFromUnknown(value: unknown): AgentFinding["agent"] | undefined {
  const parsed = AgentFindingSchema.shape.agent.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function chiefDecisionPrompt(prompt: string, findings: AgentFinding[]): string {
  return [
    "以下是用户问题、服务端事实和已经显式执行完成的专业子 Agent 发现。",
    "你必须基于这些发现形成 AdvisorDecision。不得覆盖服务端事实；不得在证据不足时给出 ACTIVE 交易承诺。",
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

function specialistPrompt(prompt: string, role: AgentFinding["agent"], priorFindings: AgentFinding[]): string {
  return [
    `当前角色：${role}`,
    "你是 Money Whisperer 的真实专业子 Agent。你必须基于服务端事实、上游角色发现和用户问题输出可展示的结构化发现。",
    "不要复述隐藏思维链；不要编造行情、持仓或用户画像；证据不足时写入 missingInformation 和 counterEvidence。",
    `用户与服务端上下文：\n${prompt}`,
    priorFindings.length ? `已完成的上游发现：${JSON.stringify(priorFindings)}` : "暂无上游发现。",
  ].join("\n\n");
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
      "counterEvidence 至少一条，supportEvidence 和 risks 最多三条，不输出隐藏推理。",
      "证据不足时明确列入 missingInformation，降低 confidence。",
    ].join("\n"),
  });
}
