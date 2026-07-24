import { Agent } from "@mastra/core/agent";

import { getDeepSeekModelConfig } from "@/server/extensions/advisor/model-config";
import { AgentFindingSchema, AdvisorDecisionSchema, type AgentFinding, type AdvisorDecision } from "@/server/extensions/advisor/professional-contracts";

export type ChiefAdvisorResult = {
  decision: AdvisorDecision;
  findings: AgentFinding[];
  delegatedAgents: AgentFinding["agent"][];
};

export function createChiefAdvisorAgent() {
  const profile = specialist("professional-profile-context", "Profile Context", "PROFILE_CONTEXT");
  const research = specialist("professional-data-research", "Data & Research", "DATA_RESEARCH");
  const risk = specialist("professional-portfolio-risk", "Portfolio & Risk", "PORTFOLIO_RISK");
  const recommendation = specialist("professional-recommendation", "Recommendation", "RECOMMENDATION");
  const compliance = specialist("professional-compliance", "Compliance Reviewer", "COMPLIANCE_REVIEWER");
  return new Agent({
    id: "professional-chief-advisor",
    name: "Chief Advisor",
    description: "根据问题风险动态委派画像、研究、组合风险、建议和合规角色。",
    model: getDeepSeekModelConfig(),
    defaultOptions: { maxSteps: 10, modelSettings: { maxOutputTokens: 1_600, temperature: 0.1 } },
    agents: { profile, research, risk, recommendation, compliance },
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
}): Promise<ChiefAdvisorResult> {
  const chief = createChiefAdvisorAgent();
  const findings: AgentFinding[] = [];
  const delegated = new Set<AgentFinding["agent"]>();
  const output = await chief.generate<AdvisorDecision>(input.prompt, {
    maxSteps: 10,
    modelSettings: { maxOutputTokens: 1_600, temperature: 0.1 },
    structuredOutput: {
      schema: AdvisorDecisionSchema,
      instructions: "只输出符合 schema 的候选建议 JSON，不要 Markdown 或隐藏推理。",
    },
    delegation: {
      onDelegationStart: ({ primitiveId, prompt }) => {
        const role = roleFromPrimitive(primitiveId);
        if (role) {
          delegated.add(role);
          input.onAgentStarted?.(role, prompt.slice(0, 160));
        }
        return { proceed: true, modifiedMaxSteps: 3 };
      },
      onDelegationComplete: ({ primitiveId, result }) => {
        const role = roleFromPrimitive(primitiveId);
        if (!role) return;
        const finding = parseFinding(result.text, role);
        if (!finding) return { feedback: `${role} 必须重新输出符合 AgentFinding schema 的 JSON。` };
        findings.push(finding);
        input.onAgentCompleted?.(finding);
        if (finding.needsAnotherAgent && finding.suggestedNextAgent) {
          return { feedback: `继续委派 ${finding.suggestedNextAgent}，处理：${finding.conclusion}` };
        }
      },
    },
  });
  const missingRequired = input.requiredAgents.filter((role) => !delegated.has(role));
  if (missingRequired.length) throw new Error(`Chief Advisor omitted mandatory agents: ${missingRequired.join(",")}`);
  return { decision: AdvisorDecisionSchema.parse(output.object), findings, delegatedAgents: [...delegated] };
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

function parseFinding(text: string, agent: AgentFinding["agent"]): AgentFinding | null {
  try {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(text)?.[1] ?? text;
    const start = fenced.indexOf("{");
    const end = fenced.lastIndexOf("}");
    const payload = JSON.parse(start >= 0 && end > start ? fenced.slice(start, end + 1) : fenced) as Record<string, unknown>;
    return AgentFindingSchema.parse({ ...payload, agent });
  } catch {
    return null;
  }
}

function roleFromPrimitive(value: string): AgentFinding["agent"] | null {
  if (/profile/iu.test(value)) return "PROFILE_CONTEXT";
  if (/data|research/iu.test(value)) return "DATA_RESEARCH";
  if (/portfolio|risk/iu.test(value)) return "PORTFOLIO_RISK";
  if (/recommendation/iu.test(value)) return "RECOMMENDATION";
  if (/compliance/iu.test(value)) return "COMPLIANCE_REVIEWER";
  return null;
}
