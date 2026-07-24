import { describe, expect, it } from "vitest";

import {
  getPandadataMethodContract,
  pandadataMethodCatalog,
  pandadataMethodWhitelist,
  PandadataAdapter,
  type PandadataProbe,
} from "@/server/advisor/pandadata";
import { runAdvisorConversation } from "@/server/advisor/runner";
import { formatAdvisorEvent } from "@/server/advisor/sse";
import { AdvisorStore } from "@/server/advisor/store";
import type { StockResearchBundle } from "@/server/advisor/stock-research";
import type { AdvisorAgentRuntime } from "@/server/advisor/agents";
import type { AdvisorAgentFinding, AdvisorDecision } from "@/server/advisor/schemas";

const unavailableData: PandadataProbe = {
  method: "get_stock_daily",
  ok: false,
  contractValidated: false,
  runtimeConfigured: false,
  liveCallSucceeded: false,
  liveDataFresh: false,
  mode: "live",
  errorCode: "PANDADATA_SDK_MISSING",
  summary: "当前环境未安装 panda_data，无法执行真实 Pandadata 调用。",
};

const dryRunOnlyData: PandadataProbe = {
  method: "get_stock_daily",
  ok: true,
  contractValidated: true,
  runtimeConfigured: true,
  liveCallSucceeded: false,
  liveDataFresh: false,
  mode: "dry_run",
  summary: "get_stock_daily 已通过 SDK 方法与参数 dry-run 校验；尚未取得真实行情数据。",
};

function finding(role: AdvisorAgentFinding["role"]): AdvisorAgentFinding {
  return {
    role,
    intent: "advisory_test",
    summary: `${role} completed`,
    missingInformation: [],
    supportEvidence: [`${role} support`],
    counterEvidence: [`${role} counter`],
    risks: [`${role} risk`],
    confidence: "MEDIUM",
    needsAnotherAgent: false,
  };
}

function decision(patch: Partial<AdvisorDecision> = {}): AdvisorDecision {
  return {
    action: "SCALE_IN",
    status: "ACTIVE",
    summary: "建议小仓位模拟试仓。",
    suitability: "MEDIUM",
    confidence: "MEDIUM",
    rationales: ["画像、组合与研究证据已被多 Agent 检查。"],
    counterEvidence: ["仍存在市场波动和数据覆盖不足。"],
    risks: ["回撤可能扩大。"],
    suggestedAllocationRange: "0%-5%",
    firstEntryAllocation: "1%-2%",
    addConditions: ["真实行情和组合约束继续满足。"],
    referenceRange: "等待数据工具给出观察区间。",
    stopLoss: "跌破风险阈值或投资逻辑失效。",
    takeProfit: "达到目标收益或估值过热时再平衡。",
    horizon: "MEDIUM",
    validUntil: "2026-07-30",
    executionPace: "分批执行，不一次性建满。",
    sellDownRatio: "不适用。",
    triggerReasons: ["用户提出加仓/买入问题。"],
    portfolioImpact: "需要确认新增仓位后的集中度。",
    alternatives: ["宽基 ETF", "继续持有现金"],
    invalidationConditions: ["数据过期", "画像或持仓信息变化"],
    sourceSummary: "fake-runtime",
    agentsConsulted: ["data_research", "portfolio_risk", "recommendation", "compliance"],
    compliance: { approved: true, decision: "APPROVED", reason: "测试通过。" },
    ...patch,
  };
}

function fakeRuntime(
  dataResults: PandadataProbe[],
  finalDecision = decision(),
  researchBundles: StockResearchBundle[] = [],
): AdvisorAgentRuntime {
  return {
    async run(input) {
      const roles: AdvisorAgentFinding["role"][] = [
        "profile",
        "data_research",
        "portfolio_risk",
        "recommendation",
        "compliance",
      ];
      for (const role of roles) {
        input.emit?.({ type: "agent.started", role, label: `${role} delegated` });
        input.emit?.({ type: "agent.completed", role, summary: `${role} completed`, finding: finding(role) });
      }
      input.emit?.({ type: "tool.started", toolName: "pandadata.get_stock_daily", inputSummary: "test" });
      input.emit?.({
        type: dataResults.some((result) => result.liveCallSucceeded) ? "tool.completed" : "tool.failed",
        toolName: "pandadata.get_stock_daily",
        outputSummary: dataResults[0]?.summary ?? "no data",
        result: dataResults[0] ?? unavailableData,
      });
      return {
        decision: finalDecision,
        findings: roles.map(finding),
        delegatedAgents: roles,
        dataResults,
        researchBundles,
        rawText: "fake",
      };
    },
  };
}

describe("advisor multi-agent runtime", () => {
  it("records child agents and degrades when Pandadata is unavailable", async () => {
    const store = new AdvisorStore();
    const result = await runAdvisorConversation({
      conversationId: "conversation_demo",
      question: "我有黄金半仓，现在涨了，要不要加仓？",
      store,
      agentRuntime: fakeRuntime([unavailableData]),
    });

    const events = store.listEvents(result.analysisId);
    const agents = events.filter((event) => event.type === "agent.started").map((event) => event.payload.agent);
    const recommendation = store.getRecommendation(result.recommendationId);

    expect(agents).toEqual(["profile", "data_research", "portfolio_risk", "recommendation", "compliance"]);
    expect(events.some((event) => event.type === "tool.failed")).toBe(true);
    expect(recommendation?.status).toBe("DEGRADED");
    expect(recommendation?.action).toBe("SCALE_IN");
  });

  it("never creates ACTIVE advice from dry-run-only data", async () => {
    const store = new AdvisorStore();
    const result = await runAdvisorConversation({
      conversationId: "conversation_dry_run",
      question: "科技板块跌了，可以入场吗？",
      store,
      agentRuntime: fakeRuntime([dryRunOnlyData], decision({ status: "ACTIVE" })),
    });
    const recommendation = store.getRecommendation(result.recommendationId);

    expect(recommendation?.status).toBe("DEGRADED");
    expect(recommendation?.action).toBe("SCALE_IN");
    expect(recommendation?.sourceSummary).toContain("live=false");
  });

  it("falls back to degraded advice when the model token is rejected", async () => {
    const store = new AdvisorStore();
    const result = await runAdvisorConversation({
      conversationId: "conversation_model_auth_fallback",
      question: "黄金涨了，我应该减仓吗？",
      store,
      agentRuntime: {
        async run() {
          throw new Error("Invalid token (request rejected with 401)");
        },
      },
    });
    const recommendation = store.getRecommendation(result.recommendationId);

    expect(recommendation).toMatchObject({
      action: "SCALE_OUT",
      status: "DEGRADED",
    });
    expect(recommendation?.summary).toContain("模型");
    expect(recommendation?.summary).toContain("仅允许模拟");
    expect(recommendation?.degradationReasons).toContain("MODEL_UNAVAILABLE");
    expect(recommendation?.summary).not.toContain("缺少模型或真实数据");
    expect(recommendation?.summary).not.toContain("模拟。，");
  });

  it("formats replayable SSE events", async () => {
    const store = new AdvisorStore();
    const result = await runAdvisorConversation({
      conversationId: "conversation_replay",
      question: "科技板块跌了，可以入场吗？",
      store,
      agentRuntime: fakeRuntime([unavailableData]),
    });
    const firstEvent = store.listEvents(result.analysisId)[0];
    const replay = store.listEvents(result.analysisId, firstEvent.id);
    const payload = formatAdvisorEvent(replay[0]);

    expect(replay[0].sequence).toBe(2);
    expect(payload).toContain(`id: ${replay[0].id}`);
    expect(payload).toContain(`event: ${replay[0].type}`);
  });
});

describe("PandadataAdapter", () => {
  it("rejects methods outside the P0 whitelist", async () => {
    const adapter = new PandadataAdapter();

    await expect(adapter.probe("drop_everything", {})).resolves.toMatchObject({
      ok: false,
      errorCode: "PANDADATA_METHOD_NOT_ALLOWED",
    });
  });

  it("loads the full local Pandadata catalog and exposes exact method contracts", () => {
    expect(pandadataMethodCatalog).toHaveLength(218);
    expect(pandadataMethodWhitelist).toHaveLength(201);
    expect(pandadataMethodWhitelist).toContain("get_option_implied_volatility");
    expect(pandadataMethodWhitelist).toContain("get_macro_tm");
    expect(getPandadataMethodContract("get_stock_daily_pre")).toMatchObject({
      allowed: true,
      descriptor: { name: "get_stock_daily_pre", sdkExported: true },
    });
  });

  it("persists stock research fields into the recommendation card", async () => {
    const store = new AdvisorStore();
    const bundle: StockResearchBundle = {
      symbol: "000001.SZ",
      name: "示例股票",
      exchange: "CN",
      source: "pandadata",
      dataQuality: "HIGH",
      dataAsOf: "2026-07-23",
      methods: ["get_stock_daily_pre", "get_fina_performance"],
      unavailableMethods: [],
      market: { lastPrice: "100", changeRate: 0.02, technical: { macdState: "DAILY_GOLDEN_CROSS" } },
      valuation: { peTtm: 12.5, pb: 1.5, peThreeYearPercentile: 0.3 },
      fundamentals: { netProfitYoY: 0.2, roe: 0.15 },
      industry: { industryName: "科技" },
      events: [],
      capitalAndFactors: {},
      coverage: { requested: 2, live: 2, unavailable: 0, liveMethods: ["get_stock_daily_pre", "get_fina_performance"] },
      supportEvidence: ["估值分位偏低"],
      counterEvidence: ["短期波动仍可能扩大"],
      probes: [],
    };
    const result = await runAdvisorConversation({
      conversationId: "conversation_stock_card",
      question: "请推荐一只适合我的股票。",
      store,
      agentRuntime: fakeRuntime([], decision(), [bundle]),
    });

    expect(store.getRecommendation(result.recommendationId)?.stockResearch?.[0]).toMatchObject({
      symbol: "000001.SZ",
      valuation: { peTtm: 12.5 },
      market: { technical: { macdState: "DAILY_GOLDEN_CROSS" } },
    });
  });
});
