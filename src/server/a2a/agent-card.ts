import type { NextRequest } from "next/server";

const AGENT_NAME = "Factor Research Agent";
const TEAM_NAME = "OOD Team Plus";
const MESSAGE_SEND_PATH = "/api/a2a/message-send";
const AGENT_CARD_PATH = "/.well-known/agent-card.json";

export function buildAgentCard(request?: NextRequest) {
  const baseUrl = publicBaseUrl(request);
  const serviceEndpoint = `${baseUrl}${MESSAGE_SEND_PATH}`;
  const agentCardUrl = `${baseUrl}${AGENT_CARD_PATH}`;

  return {
    name: AGENT_NAME,
    description: "Handles natural-language investment research through an A2A Remote Agent endpoint, reusing the local advisor workflow for profiling, evidence-backed research, portfolio risk analysis, factor research, deterministic strategy backtests, recommendation drafting, and compliance-gated explanations. The product is research- and simulation-only and does not connect to brokers or place orders.",
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
      streaming: true,
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
        id: "advisor_chat",
        name: "advisor_chat",
        description: "Run the Chief Advisor conversation loop and surface specialist findings.",
        tags: ["advisor", "chat", "research"],
        inputModes: ["text/plain"],
        outputModes: ["text/markdown", "application/json"],
      },
      {
        id: "factor_analysis",
        name: "factor_analysis",
        description: "Analyze factor, signal, and market context using authorized data and research skills.",
        tags: ["factor", "research", "market"],
        inputModes: ["text/plain"],
        outputModes: ["text/markdown"],
      },
      {
        id: "portfolio_risk_review",
        name: "portfolio_risk_review",
        description: "Review holdings, risk exposure, missing information, and scenario-sensitive recommendations.",
        tags: ["portfolio", "risk", "compliance"],
        inputModes: ["text/plain"],
        outputModes: ["text/markdown"],
      },
      {
        id: "factor_research",
        name: "factor_research",
        description: "通过顾问入口调用 PandaData get_factor，返回因子样本、描述统计、数据日期和不能据此推导的 IC 限制。",
        tags: ["factor", "quant", "research", "pandadata"],
        inputModes: ["text/plain"],
        outputModes: ["text/markdown", "application/json"],
      },
      {
        id: "strategy_backtest",
        name: "strategy_backtest",
        description: "通过顾问入口调用历史行情并执行确定性策略回测，公开样本区间、交易成本、收益、回撤和限制。",
        tags: ["strategy", "backtest", "research", "simulation"],
        inputModes: ["text/plain"],
        outputModes: ["text/markdown", "application/json"],
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
        ],
        publicationStates: ["ACTIVE", "DEGRADED", "BLOCKED"],
      },
      productCapabilities: [
        {
          id: "advisor_chat",
          name: "Advisor Chat",
          access: "a2a_and_workbench",
          description: "The main Chief Advisor conversation experience.",
        },
        {
          id: "factor_research",
          name: "Factor Research",
          access: "a2a_and_workbench",
          description: "通过顾问 Agent 调用 PandaData get_factor 并公开样本统计和研究限制。",
        },
        {
          id: "strategy_backtest",
          name: "Strategy Backtest",
          access: "a2a_and_workbench",
          description: "通过顾问 Agent 调用历史行情执行确定性策略回测，并公开回测假设。",
        },
      ],
      a2aScope: {
        gateway: "message/send",
        directAccess: ["advisor_chat", "factor_research", "strategy_backtest"],
        productWorkflows: [],
        note: "Every declared A2A skill is routed through the Chief Advisor message/send entrypoint; no separate factor or backtest endpoint is implied.",
      },
      dataSkills: ["semantic_catalog", "pandadata_research", "portfolio_snapshot", "market_observability"],
      researchSkills: ["factor_analysis", "strategy_backtest", "portfolio_risk_review", "compliance_review", "profile_context", "data_research", "factor_research", "portfolio_risk", "recommendation", "explanation_report"],
      examplePrompts: [
        "Analyze AAPL current add-on suitability and explain the main risks.",
        "Diagnose my portfolio risk and list the data you still need.",
        "Run factor research on 000001.SZ, return close and volume sample stats, and say what is still missing for IC.",
        "Run a 20-day moving-average backtest on AAPL and list the sample, cost, return, drawdown, and limits.",
      ],
      disclaimer: "输出仅用于研究和比赛评审，不构成投资建议、收益承诺、荐股或代客理财。",
    },
  };
}

export function publicBaseUrl(request?: NextRequest): string {
  const configured = process.env.APP_ORIGIN?.split(",")[0]?.trim();
  if (!request) return "http://localhost:3000";
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const requestHost = request.headers.get("host") || request.nextUrl.host;
  if (configured && isLocalHost(requestHost) && isLocalConfiguredOrigin(configured)) {
    const localProto = request.nextUrl.protocol.replace(":", "") || "http";
    return `${localProto}://${requestHost}`.replace(/\/+$/u, "");
  }
  if (configured && (forwardedProto || forwardedHost)) return configured.replace(/\/+$/u, "");
  const proto = forwardedProto || request.nextUrl.protocol.replace(":", "");
  const host = forwardedHost || requestHost;
  return `${proto}://${host}`.replace(/\/+$/u, "");
}

function isLocalHost(host: string): boolean {
  return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/iu.test(host);
}

function isLocalConfiguredOrigin(value: string): boolean {
  try {
    return isLocalHost(new URL(value).host);
  } catch {
    return false;
  }
}
