import type { NextRequest } from "next/server";

const AGENT_NAME = "Factor Research Agent";
const TEAM_NAME = "OOD Team Plus";
const MESSAGE_SEND_PATH = "/api/a2a/message-send";
const HTTP_MESSAGE_SEND_PATH = "/api/a2a/message:send";
const AGENT_CARD_PATH = "/.well-known/agent-card.json";

export function buildAgentCard(request?: NextRequest) {
  const baseUrl = publicBaseUrl(request);
  const serviceEndpoint = `${baseUrl}${MESSAGE_SEND_PATH}`;
  const httpServiceEndpoint = `${baseUrl}${HTTP_MESSAGE_SEND_PATH}`;
  const agentCardUrl = `${baseUrl}${AGENT_CARD_PATH}`;

  return {
    name: AGENT_NAME,
    description: "Money Whisperer's primary multi-agent research and simulation gateway. External agents can run Chief Advisor conversations, multi-round bull/bear debates, stateful branch simulations, and independent research searches under isolated caller-owned contexts. It never connects to brokers or places orders.",
    provider: {
      organization: TEAM_NAME,
      url: baseUrl,
    },
    version: "1.1.0",
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
      {
        url: httpServiceEndpoint,
        protocolBinding: "HTTP+JSON",
        protocolVersion: "1.0",
        transport: "HTTP+JSON",
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
        description: "Send the client-specific token returned once by the A2A client administration API.",
      },
    },
    securityRequirements: [{ bearerAuth: [] }],
    security: [{ bearerAuth: [] }],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/markdown", "application/json"],
    extensions: [{
      uri: `${baseUrl}/docs/a2a-submission#capability-metadata`,
      description: "Use message.metadata.capabilityId, operation, and input to invoke a stateful Money Whisperer capability.",
      required: false,
    }],
    skills: [
      {
        id: "chief_advisor_conversation",
        name: "Chief Advisor Conversation",
        description: "Run the main Chief Advisor and specialist-agent publication workflow. Operations: send, answer_clarification.",
        tags: ["advisor", "chat", "research"],
        inputModes: ["text/plain"],
        outputModes: ["text/markdown", "application/json"],
      },
      {
        id: "debate_mode",
        name: "Bull/Bear Debate",
        description: "Run a stateful multi-round evidence, bull, bear, and judge workflow. Operations: start, continue, question_bull, question_bear, join_bull, join_bear, summarize, finalize.",
        tags: ["debate", "bull", "bear", "judge"],
        inputModes: ["text/plain"],
        outputModes: ["text/markdown", "application/json"],
      },
      {
        id: "scenario_simulation",
        name: "Scenario Branch Simulation",
        description: "Create and operate caller-owned portfolio branches. Operations: start, generate_options, get_options, execute_option, get_tree, get_snapshot, switch_branch, undo, archive.",
        tags: ["simulation", "portfolio", "branch", "risk"],
        inputModes: ["text/plain"],
        outputModes: ["text/markdown", "application/json"],
      },
      {
        id: "research_search",
        name: "Independent Research Search",
        description: "Search web, MCP, knowledge-base, and RSS sources with citations. Operations: start, get_results, refine, retry, cancel.",
        tags: ["research", "search", "citations", "evidence"],
        inputModes: ["text/plain"],
        outputModes: ["text/markdown", "application/json"],
      },
    ],
    documentationUrl: `${baseUrl}/docs/a2a-submission`,
    metadata: {
      team: TEAM_NAME,
      agentCardUrl,
      serviceEndpoint,
      httpServiceEndpoint,
      taskListEndpoint: `${baseUrl}/api/a2a/tasks`,
      taskEndpointTemplate: `${baseUrl}/api/a2a/tasks/{id}`,
      contextDeleteEndpointTemplate: `${baseUrl}/api/a2a/contexts/{id}`,
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
          id: "chief_advisor_conversation",
          name: "Chief Advisor Conversation",
          access: "a2a_and_workbench",
          description: "The main Chief Advisor conversation experience.",
        },
        {
          id: "debate_mode",
          name: "Bull/Bear Debate",
          access: "a2a_and_workbench",
          description: "Multi-round evidence-backed debate with judge summaries and final publication.",
        },
        {
          id: "scenario_simulation",
          name: "Scenario Simulation",
          access: "a2a_and_workbench",
          description: "Caller-owned portfolio branches using server-resolved market prices.",
        },
        {
          id: "research_search",
          name: "Independent Research Search",
          access: "a2a_and_workbench",
          description: "Independent multi-source research with citations and source status.",
        },
      ],
      a2aScope: {
        gateway: ["message/send", "message:send"],
        directAccess: [
          "chief_advisor_conversation",
          "debate_mode",
          "scenario_simulation",
          "research_search",
        ],
        contextRetentionDays: 30,
        callerDataIsolation: "Each context receives a non-login execution principal.",
      },
      taskExecution: {
        mode: "bounded_initial_wait_then_async_polling",
        pollEndpointTemplate: `${baseUrl}/api/a2a/tasks/{id}`,
        pendingStates: ["submitted", "working"],
        terminalStates: ["completed", "input-required", "failed", "canceled"],
      },
      examplePrompts: [
        "Review my caller-supplied portfolio and explain the main risks.",
        "Start a bull/bear debate on whether AAPL valuation is justified.",
        "Create hold, rebalance, and defensive scenario branches.",
        "Search independent sources for current AAPL supply-chain risks.",
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
