import { Agent } from "@mastra/core/agent";

import { memory } from "@/mastra";
import { getDeepSeekModelConfig } from "@/server/chat/environment";
import { currentDateIso } from "@/server/advisor/date-utils";
import { PandadataAdapter, type PandadataProbe } from "@/server/advisor/pandadata";
import {
  createPandadataCatalogTool,
  createPandadataContractTool,
  createPandadataQueryTool,
  createStockResearchTool,
  type AdvisorToolEvent,
} from "@/server/advisor/agent-tools";
import type { StockResearchBundle } from "@/server/advisor/stock-research";
import {
  advisorAgentFindingSchema,
  advisorDecisionSchema,
  type AdvisorAgentFinding,
  type AdvisorDecision,
} from "@/server/advisor/schemas";
import type { AdvisorAgentRole } from "@/server/advisor/types";

type RuntimeEvent = AdvisorToolEvent;

export type AdvisorAgentRuntimeInput = {
  conversationId: string;
  question: string;
  emit?: (event: RuntimeEvent) => void;
  abortSignal?: AbortSignal;
};

export type AdvisorAgentRuntimeOutput = {
  decision: AdvisorDecision;
  findings: AdvisorAgentFinding[];
  delegatedAgents: AdvisorAgentRole[];
  dataResults: PandadataProbe[];
  researchBundles?: StockResearchBundle[];
  rawText: string;
};

export type AdvisorAgentRuntime = {
  run(input: AdvisorAgentRuntimeInput): Promise<AdvisorAgentRuntimeOutput>;
};

type PandadataLiveAdapter = {
  fetch(method: string, params: Record<string, unknown>): Promise<PandadataProbe>;
};

const modelSettings = { maxOutputTokens: 1_200, temperature: 0.2 };

export class MastraAdvisorAgentRuntime implements AdvisorAgentRuntime {
  constructor(private readonly adapter: PandadataLiveAdapter = new PandadataAdapter()) {}

  async run(input: AdvisorAgentRuntimeInput): Promise<AdvisorAgentRuntimeOutput> {
    const findings: AdvisorAgentFinding[] = [];
    const dataResults: PandadataProbe[] = [];
    const researchBundles: StockResearchBundle[] = [];
    const delegatedAgents = new Set<AdvisorAgentRole>();
    const agents = createAdvisorAgents(this.adapter, dataResults, researchBundles, input.emit);

    const output = await agents.chief.generate<AdvisorDecision>(buildChiefPrompt(input.question), {
      maxSteps: 10,
      memory: { thread: input.conversationId, resource: "demo-user" },
      modelSettings,
      abortSignal: input.abortSignal,
      structuredOutput: {
        schema: advisorDecisionSchema,
        instructions: "只输出最终建议卡 JSON，不要包含隐藏推理或 Markdown。",
      },
      delegation: {
        onDelegationStart: ({ primitiveId, prompt }) => {
          const role = roleFromPrimitive(primitiveId);
          if (!role) return { proceed: true };
          delegatedAgents.add(role);
          input.emit?.({ type: "agent.started", role, label: prompt.slice(0, 120) });
          return { proceed: true, modifiedMaxSteps: 3 };
        },
        onDelegationComplete: ({ primitiveId, result }) => {
          const role = roleFromPrimitive(primitiveId);
          if (!role) return;
          const finding = parseFinding(result.text, role);
          const summary = finding?.summary ?? result.text.slice(0, 240);
          if (finding) findings.push(finding);
          input.emit?.({ type: "agent.completed", role, summary, ...(finding ? { finding } : {}) });
          if (!finding) return { feedback: `${role} 必须重新输出符合约定的 JSON 结构。` };
          if (finding.needsAnotherAgent && finding.suggestedNextAgent) {
            return { feedback: `请继续委派 ${finding.suggestedNextAgent} 处理：${finding.summary}` };
          }
        },
      },
    });

    return {
      decision: advisorDecisionSchema.parse(output.object),
      findings,
      delegatedAgents: Array.from(delegatedAgents),
      dataResults,
      researchBundles,
      rawText: output.text,
    };
  }
}

function createAdvisorAgents(
  adapter: PandadataLiveAdapter,
  dataResults: PandadataProbe[],
  researchBundles: StockResearchBundle[],
  emit?: (event: RuntimeEvent) => void,
) {
  const profile = specialistAgent("advisor-profile-agent", "Profile Agent", "profile");
  const portfolioRisk = specialistAgent(
    "advisor-portfolio-risk-agent",
    "Portfolio & Risk Agent",
    "portfolio_risk",
  );
  const recommendation = specialistAgent(
    "advisor-recommendation-agent",
    "Recommendation Agent",
    "recommendation",
  );
  const compliance = specialistAgent("advisor-compliance-agent", "Compliance Agent", "compliance");
  const dataResearch = new Agent({
    id: "advisor-data-research-agent",
    name: "Data & Research Agent",
    description: "选择 Pandadata 方法，获取真实行情/财务/指数/基金数据，区分事实、推断和缺失。",
    model: getDeepSeekModelConfig(),
    defaultOptions: { maxSteps: 3, modelSettings },
    tools: {
      pandadataCatalog: createPandadataCatalogTool(),
      pandadataContract: createPandadataContractTool(),
      pandadataQuery: createPandadataQueryTool(adapter, dataResults, emit),
      stockResearchBundle: createStockResearchTool(adapter, dataResults, researchBundles, emit),
    },
    skills: [".codex/skills/pandadata-api"],
    instructions: specialistInstructions("data_research"),
  });

  const chief = new Agent({
    id: "advisor-chief-agent",
    name: "Chief Advisor Agent",
    description: "动态委派画像、研究、组合风险、建议和合规 Agent，并合成建议卡。",
    model: getDeepSeekModelConfig(),
    defaultOptions: { maxSteps: 10, modelSettings },
    memory,
    agents: { profile, dataResearch, portfolioRisk, recommendation, compliance },
    instructions: [
      "你是 Money Whisperer 的 Chief Advisor，不是固定 DAG。",
      "你必须自己判断缺失信息、委派顺序、是否补充质询、是否降级。",
      "涉及买入、卖出、加仓、减仓时，至少委派 dataResearch、portfolioRisk、recommendation、compliance。",
      "涉及个股推荐、适配性筛选或用户询问某只股票时，优先委派 dataResearch，并让它使用 stockResearchBundle；需要补充接口时先用 pandadataCatalog，再用 pandadataContract 读取精确参数，最后用 pandadataQuery 执行。",
      "如果 stockResearchBundle 返回了一个明确的首选标的，在最终 JSON 中填 primaryInstrument.symbol/name；如果没有明确标的则省略。",
      "如果用户画像或持仓/资金/期限不完整，先委派 profile 并在最终建议中降级或追问。",
      "Pandadata dry-run 只代表方法契约通过，不能视为真实行情。",
      "没有新鲜真实数据、反方证据或组合影响时，最终 status 必须是 DEGRADED 或 BLOCKED。",
      "最终通过 structuredOutput 输出建议卡字段，禁止保证收益和确定性涨跌措辞。",
    ].join("\n"),
  });

  return { chief };
}

function specialistAgent(id: string, name: string, role: AdvisorAgentFinding["role"]) {
  return new Agent({
    id,
    name,
    description: `${name} 输出 ${role} 的结构化证据、缺失信息、风险和下一步建议。`,
    model: getDeepSeekModelConfig(),
    defaultOptions: { maxSteps: 1, modelSettings },
    instructions: specialistInstructions(role),
  });
}

function specialistInstructions(role: AdvisorAgentFinding["role"]) {
  return [
    `你的角色是 ${role}，只处理 Chief Advisor 委派的任务。`,
    "输出必须是单个 JSON 对象，不要 Markdown，不要解释 schema。",
    "JSON 字段：role,intent,summary,missingInformation,supportEvidence,counterEvidence,risks,confidence,needsAnotherAgent,suggestedNextAgent。",
    "counterEvidence 至少 1 条；supportEvidence 和 risks 最多 3 条；不要输出隐藏推理。",
    "如果证据不足，应明确写入 missingInformation，并把 confidence 设为 LOW。",
  ].join("\n");
}

function buildChiefPrompt(question: string) {
  return [
    `用户问题：${question}`,
    "请按需委派专业 Agent，必要时让研究和风控互相挑战。",
    `当前日期是 ${currentDateIso()}；涉及当前买卖建议时，Pandadata 数据必须新鲜。`,
    "如果无法满足硬规则，输出观察/降级/阻断，而不是明确买卖建议。",
  ].join("\n");
}

function parseFinding(text: string, role: AdvisorAgentFinding["role"]) {
  try {
    return advisorAgentFindingSchema.parse({ ...JSON.parse(extractJson(text)), role });
  } catch {
    return null;
  }
}

function extractJson(text: string) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  return start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
}

function roleFromPrimitive(primitiveId: string): AdvisorAgentFinding["role"] | null {
  if (/profile/i.test(primitiveId)) return "profile";
  if (/data|research/i.test(primitiveId)) return "data_research";
  if (/portfolio|risk/i.test(primitiveId)) return "portfolio_risk";
  if (/recommendation/i.test(primitiveId)) return "recommendation";
  if (/compliance/i.test(primitiveId)) return "compliance";
  return null;
}
