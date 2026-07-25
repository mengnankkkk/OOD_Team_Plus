import type { NextRequest } from "next/server";

const AGENT_NAME = "Money Whisperer Chief Advisor";
const TEAM_NAME = "OOD Team Plus";
const MESSAGE_SEND_PATH = "/api/a2a/message-send";
const AGENT_CARD_PATH = "/.well-known/agent-card.json";

export function buildAgentCard(request?: NextRequest) {
  const baseUrl = publicBaseUrl(request);
  const serviceEndpoint = `${baseUrl}${MESSAGE_SEND_PATH}`;
  const agentCardUrl = `${baseUrl}${AGENT_CARD_PATH}`;

  return {
    name: AGENT_NAME,
    description: "Money Whisperer's primary multi-agent financial research and advisory agent. It orchestrates user profiling, evidence-backed research, portfolio risk analysis, scenario reasoning, recommendation drafting, and compliance-gated explanations. The product is for research and simulation only and does not connect to brokers or place orders.",
    provider: {
      organization: TEAM_NAME,
      url: baseUrl,
    },
    version: "1.0.0",
    url: serviceEndpoint,
    preferredTransport: "JSONRPC",
    protocolVersion: "1.0",
    supportedInterfaces: [
      {
        url: serviceEndpoint,
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
        transport: "JSONRPC",
      },
    ],
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "opaque",
        description: "Send Authorization: Bearer <A2A_BEARER_TOKEN>.",
      },
    },
    securityRequirements: [{ bearerAuth: [] }],
    security: [{ bearerAuth: [] }],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/markdown", "application/json"],
    skills: [
      {
        id: "chief_advisor_conversation",
        name: "chief_advisor_conversation",
        description: "Orchestrate a natural-language advisory task through the Chief Advisor and its professional specialist agents.",
        tags: ["chief-advisor", "conversation", "orchestration"],
        inputModes: ["text/plain"],
        outputModes: ["text/markdown"],
      },
      {
        id: "profile_and_goal_planning",
        name: "profile_and_goal_planning",
        description: "Build or review a user's risk profile, investment goals, constraints, liquidity needs, and missing information.",
        tags: ["profile", "goals", "risk"],
        inputModes: ["text/plain"],
        outputModes: ["text/markdown", "application/json"],
      },
      {
        id: "evidence_backed_research",
        name: "evidence_backed_research",
        description: "Research instruments, markets, events, and data freshness using semantic data tools and authorized market sources.",
        tags: ["research", "evidence", "market-data"],
        inputModes: ["text/plain"],
        outputModes: ["text/markdown", "application/json"],
      },
      {
        id: "portfolio_risk_diagnosis",
        name: "portfolio_risk_diagnosis",
        description: "Analyze holdings, concentration, drawdown, exposure, stress cases, and the effect of a proposed portfolio action.",
        tags: ["portfolio", "risk", "stress-test"],
        inputModes: ["text/plain"],
        outputModes: ["text/markdown", "application/json"],
      },
      {
        id: "recommendation_and_compliance",
        name: "recommendation_and_compliance",
        description: "Draft research-only recommendations with supporting and counter evidence, invalidation conditions, and a server-side compliance publication gate.",
        tags: ["recommendation", "compliance", "explainability"],
        inputModes: ["text/plain"],
        outputModes: ["text/markdown"],
      },
    ],
    documentationUrl: `${baseUrl}/docs/a2a-submission`,
    metadata: {
      team: TEAM_NAME,
      agentCardUrl,
      serviceEndpoint,
      auth: "Bearer token",
      agentArchitecture: {
        rootAgent: "professional-chief-advisor",
        rootAgentName: "Chief Advisor",
        conversationEntrypoint: "runConversationAgent",
        professionalEntrypoint: "runProfessionalAdvisor",
        orchestration: "Chief Advisor delegates specialist agents, then the server applies the publication gate.",
        specialistAgents: [
          "PROFILE_CONTEXT",
          "DATA_RESEARCH",
          "PORTFOLIO_RISK",
          "RECOMMENDATION",
          "COMPLIANCE_REVIEWER",
          "EXPLANATION_REPORT",
          "SCENARIO_PLANNER",
        ],
        publicationStates: ["ACTIVE", "DEGRADED", "BLOCKED"],
      },
      productCapabilities: [
        {
          id: "advisor_chat",
          name: "专业 Advisor Chat",
          access: "a2a_and_workbench",
          description: "The main Chief Advisor conversation experience.",
        },
        {
          id: "debate_mode",
          name: "多空辩论模式",
          access: "workbench",
          description: "A bull-versus-bear discussion mode for comparing evidence, assumptions, counterarguments, and open questions.",
        },
        {
          id: "scenario_simulation",
          name: "分支情景模拟",
          access: "workbench_api",
          description: "Generate and compare hold, rebalance, and defensive branches using frozen snapshots and a deterministic simulation engine.",
        },
        {
          id: "evidence_lab",
          name: "Evidence Lab",
          access: "workbench_api",
          description: "Inspect evidence packs, data snapshots, research metrics, counter evidence, and decision provenance.",
        },
        {
          id: "research_search",
          name: "研究搜索",
          access: "workbench_api",
          description: "Run web, MCP, knowledge-base, and RSS-backed research searches with citations and evidence linkage.",
        },
        {
          id: "semantic_query_and_artifacts",
          name: "语义查数与产物生成",
          access: "a2a_and_workbench",
          description: "Use the semantic catalog for read-only data queries and produce chart or Markdown artifacts.",
        },
        {
          id: "portfolio_and_goal_management",
          name: "画像、目标与组合管理",
          access: "workbench_api",
          description: "Maintain risk questionnaires, goals, holdings, portfolio snapshots, and recommendation decisions.",
        },
        {
          id: "monitoring_and_alerts",
          name: "自选与组合监控",
          access: "background_and_workbench",
          description: "Evaluate watch conditions and portfolio alerts, then expose notifications and preference controls.",
        },
      ],
      a2aScope: {
        gateway: "message/send",
        directAccess: ["advisor_chat", "semantic_query_and_artifacts"],
        productWorkflows: ["debate_mode", "scenario_simulation", "evidence_lab", "research_search", "portfolio_and_goal_management", "monitoring_and_alerts"],
        note: "The A2A endpoint is the conversational gateway. Product-specific workflows may use their dedicated /api/v1 endpoints and persisted analysis/SSE state.",
      },
      dataSkills: ["semantic_catalog", "pandadata_research", "portfolio_snapshot", "market_observability"],
      researchSkills: ["profile_context", "data_research", "portfolio_risk", "recommendation", "compliance_review", "explanation_report"],
      examplePrompts: [
        "分析 AAPL 当前是否适合加仓，并说明主要风险。",
        "基于我的持仓做一次组合风险诊断，给出需要补充的数据。",
        "请用多空辩论方式分析这个投资假设，分别列出最强支持证据和反方证据。",
        "为当前组合生成保持、再平衡和降险三种模拟分支，并说明失效条件。",
      ],
      disclaimer: "输出仅用于研究和比赛评审，不构成投资建议、收益承诺、荐股或代客理财。",
    },
  };
}

function publicBaseUrl(request?: NextRequest): string {
  const configured = process.env.APP_ORIGIN?.split(",")[0]?.trim();
  if (configured) return configured.replace(/\/+$/u, "");
  if (!request) return "http://localhost:3000";
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || request.nextUrl.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || request.nextUrl.host;
  return `${proto}://${host}`.replace(/\/+$/u, "");
}
