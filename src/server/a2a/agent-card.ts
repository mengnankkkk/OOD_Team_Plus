import type { NextRequest } from "next/server";

const AGENT_NAME = "Factor Research Agent";
const TEAM_NAME = "OOD Team Plus";
const MESSAGE_SEND_PATH = "/api/a2a/message-send";

export function buildAgentCard(request?: NextRequest) {
  const baseUrl = publicBaseUrl(request);
  return {
    name: AGENT_NAME,
    description: "A remote research agent for portfolio diagnostics, factor-style analysis, strategy backtesting summaries, and compliance-aware investment research explanations.",
    provider: {
      organization: TEAM_NAME,
      url: baseUrl,
    },
    version: "1.0.0",
    url: baseUrl,
    preferredTransport: "JSONRPC",
    protocolVersion: "1.0",
    supportedInterfaces: [
      { transport: "JSONRPC", url: `${baseUrl}${MESSAGE_SEND_PATH}` },
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
    security: [{ bearerAuth: [] }],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/markdown", "application/json"],
    skills: [
      {
        id: "factor_analysis",
        name: "factor_analysis",
        description: "Analyze factor, signal, and market context using authorized data and research skills.",
        tags: ["factor", "research", "market"],
        inputModes: ["text/plain"],
        outputModes: ["text/markdown"],
      },
      {
        id: "strategy_backtest",
        name: "strategy_backtest",
        description: "Run or summarize strategy backtests and explain assumptions, limits, and risks.",
        tags: ["backtest", "strategy", "simulation"],
        inputModes: ["text/plain"],
        outputModes: ["text/markdown", "application/json"],
      },
      {
        id: "portfolio_risk_review",
        name: "portfolio_risk_review",
        description: "Review holdings, risk exposure, missing information, and scenario-sensitive recommendations.",
        tags: ["portfolio", "risk", "compliance"],
        inputModes: ["text/plain"],
        outputModes: ["text/markdown"],
      },
    ],
    documentationUrl: `${baseUrl}/docs/a2a-submission`,
    metadata: {
      team: TEAM_NAME,
      serviceEndpoint: `${baseUrl}${MESSAGE_SEND_PATH}`,
      auth: "Bearer token",
      dataSkills: ["semantic_catalog", "pandadata_research", "portfolio_snapshot", "market_observability"],
      researchSkills: ["factor_analysis", "strategy_backtest", "portfolio_risk_review", "compliance_review"],
      examplePrompts: [
        "分析 AAPL 当前是否适合加仓，并说明主要风险。",
        "基于我的持仓做一次组合风险诊断，给出需要补充的数据。",
        "回测一个低波动因子策略，并解释假设和预期输出格式。",
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
