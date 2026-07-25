import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/frontend-migration/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("@/services/advisorService", () => ({
  sendAdvisorMessageStream: vi.fn(),
}));

import { apiGet } from "@/features/frontend-migration/api";
import { sendAdvisorMessageStream } from "@/services/advisorService";
import { getEvidenceForAnalysis, getRecommendation, runAgentWorkflow } from "./recommendationService";

describe("runAgentWorkflow", () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
    vi.mocked(sendAdvisorMessageStream).mockReset();
  });

  it("runs the real advisor loop and returns the persisted recommendation", async () => {
    vi.mocked(sendAdvisorMessageStream).mockResolvedValue({
      reply: "组合建议已生成",
      profileUpdate: null,
      trace: null,
      sessionId: "conversation-today",
      analysisId: "analysis-today",
      recommendationId: "recommendation-today",
      artifact: null,
      clarificationId: null,
    });
    vi.mocked(apiGet).mockResolvedValue({
      id: "recommendation-today",
      analysisId: "analysis-today",
      action: "HOLD",
      status: "ACTIVE",
      summary: "维持核心仓位并控制集中度",
      positionRange: ["60%", "80%"],
      reasons: ["组合集中度仍在风险预算内"],
      counterEvidence: ["市场波动可能上升"],
      risks: ["单一持仓占比可能放大回撤"],
      compliance: { status: "PASSED", reasons: [] },
      expiresAt: "2026-10-23T00:00:00.000Z",
      createdAt: "2026-07-25T00:00:00.000Z",
    });

    const result = await runAgentWorkflow("home_manual");

    expect(sendAdvisorMessageStream).toHaveBeenCalledWith(
      expect.stringContaining("今日组合建议"),
      null,
      "SQL_ONLY",
      expect.any(Object),
      "DAILY_PORTFOLIO",
    );
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]?.id).toBe("recommendation-today");
    expect(result.recommendations[0]?.effectiveUntil).toBe("2026-10-23");
    expect(result.runId).toBe("analysis-today");
  });
});

describe("recommendation and evidence mapping", () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
  });

  it("preserves a blocked recommendation instead of making it active", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      id: "recommendation-blocked",
      analysisId: "analysis-blocked",
      action: "WATCH",
      status: "BLOCKED",
      summary: "行情不可用，暂不调整",
      positionRange: ["0%", "0%"],
      reasons: [],
      counterEvidence: ["缺少实时行情"],
      risks: [],
      compliance: { status: "BLOCKED", reasons: ["行情不可用"] },
      createdAt: "2026-07-25T08:00:00.000Z",
    });

    const recommendation = await getRecommendation("user-1", "recommendation-blocked");

    expect(recommendation).toMatchObject({
      id: "recommendation-blocked",
      status: "blocked",
      complianceStatus: "blocked",
    });
  });

  it("keeps the full backend evidence pack instead of replacing it with placeholders", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      analysisId: "analysis-1",
      analysis: { analysisId: "analysis-1", type: "CONVERSATION_AGENT", status: "BLOCKED", createdAt: "2026-07-25T08:00:00.000Z" },
      dataFreshness: { marketDataAsOf: null, status: "UNAVAILABLE" },
      evidence: [{
        id: "evidence-1",
        stance: "COUNTER",
        title: "行情不可用",
        summary: "PandaData 没有返回行情",
        dataAsOf: null,
        sources: [{ type: "PANDADATA", reference: "get_us_daily", freshness: "UNAVAILABLE" }],
      }],
      agentTrace: [{ id: "run-1", agent: "DATA_RESEARCH", status: "FAILED", purpose: "读取行情" }],
      toolCalls: [{ id: "tool-1", toolName: "pandadata", status: "FAILED" }],
      skillRuns: [{ id: "skill-1", skill: { slug: "pandadata-api" }, method: "get_us_daily", status: "FAILED", quality: "UNAVAILABLE" }],
      pandadataProbes: [{ id: "probe-1", method: "get_us_daily", phase: "LIVE_CALL", status: "FAILED" }],
      marketSnapshots: [],
      conflicts: [],
      recommendations: [{ id: "recommendation-1", status: "BLOCKED" }],
      compliance: { status: "BLOCKED", reasons: ["行情不可用"] },
      missingEvidence: ["缺少可用市场行情。"],
      retry: { allowed: false, reason: "当前运行类型不支持原样重试" },
      disclaimer: "仅用于研究。",
    });

    const pack = await getEvidenceForAnalysis("analysis-1");

    expect(pack).toMatchObject({
      analysisId: "analysis-1",
      status: "BLOCKED",
      dataFreshness: { status: "UNAVAILABLE" },
      evidence: [{ id: "evidence-1", sources: [{ reference: "get_us_daily" }] }],
      agentTrace: [{ agent: "DATA_RESEARCH" }],
      toolCalls: [{ toolName: "pandadata" }],
      skillRuns: [{ method: "get_us_daily" }],
      pandadataProbes: [{ method: "get_us_daily" }],
      missingEvidence: ["缺少可用市场行情。"],
    });
  });
});
