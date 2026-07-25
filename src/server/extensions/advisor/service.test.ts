import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { seedAuthenticatedUser, TEST_USER_ID, authenticatedRequest } from "@tests/helpers/auth";
import { GET as listMessages } from "@/app/api/v1/conversations/[id]/messages/route";
import { getDatabase, isoNow } from "@/server/http/context";
import { getSseEvents } from "@/server/extensions/sse/event-persister";

const professional = vi.hoisted(() => ({
  runProfessionalAdvisor: vi.fn(),
}));

vi.mock("./professional", () => professional);

import { runAdvisorPublicationGate, runConversationAgent } from "./service";

const conversationId = "conversation-advisor-debate-suggestion";
let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-advisor-service-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
  seedAuthenticatedUser();
  const db = getDatabase();
  const now = isoNow();
  db.prepare(`INSERT INTO conversation_sessions
    (id,user_id,title,status,created_at,updated_at,row_version)
    VALUES (?,?,?,'active',?,?,1)`).run(conversationId, TEST_USER_ID, "Advisor", now, now);
  db.close();
  professional.runProfessionalAdvisor.mockResolvedValue({
    runId: "analysis_mock",
    status: "DEGRADED",
    direction: "HOLD",
    action: "WATCH",
    findings: [],
    missingInformation: [],
    recommendation: null,
    answer: "当前先观察，建议比较多空证据。",
    provider: "CHIEF_ADVISOR",
    debateSuggestion: {
      recommended: true,
      motion: "未来 1-3 个月是否应继续持有该标的",
      reason: "多空证据存在真实分歧，适合让用户比较双方依据",
    },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  professional.runProfessionalAdvisor.mockReset();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
});

describe("advisor debate suggestion persistence", () => {
  it("returns, streams, persists, and restores the LLM debate suggestion", async () => {
    const result = await runConversationAgent({
      userId: TEST_USER_ID,
      sessionId: conversationId,
      content: "请分析当前标的是否值得继续持有",
    });

    const suggestion = {
      recommended: true,
      motion: "未来 1-3 个月是否应继续持有该标的",
      reason: "多空证据存在真实分歧，适合让用户比较双方依据",
    };
    expect(result.debateSuggestion).toEqual(suggestion);

    const db = getDatabase();
    const assistant = db.prepare("SELECT metadata_json FROM messages WHERE session_id=? AND role='assistant'").get(conversationId) as { metadata_json: string };
    const run = db.prepare("SELECT result_json FROM agent_runs WHERE id=?").get(result.analysis.analysisId) as { result_json: string };
    db.close();
    expect(JSON.parse(assistant.metadata_json).debateSuggestion).toEqual(suggestion);
    expect(JSON.parse(run.result_json).debateSuggestion).toEqual(suggestion);

    const completed = getSseEvents(result.analysis.analysisId).find((event) => event.type === "agent.completed");
    expect(completed?.payload.debateSuggestion).toEqual(suggestion);

    const history = await listMessages(
      authenticatedRequest(`http://localhost/api/v1/conversations/${conversationId}/messages`),
      { params: Promise.resolve({ id: conversationId }) },
    );
    const historyBody = await history.json();
    const restoredAssistant = historyBody.data.items.find((item: { role: string }) => item.role === "assistant");
    expect(JSON.parse(restoredAssistant.metadata_json).debateSuggestion).toEqual(suggestion);
  });

  it("runs a Battle handoff through the existing advisor publication gate", async () => {
    const db = getDatabase();
    const now = isoNow();
    db.prepare(`INSERT INTO instruments
      (id,symbol,name,market,asset_type,tradable)
      VALUES ('instrument_510300','510300.OF','沪深300ETF','OF','ETF',1)`).run();
    db.prepare(`INSERT INTO agent_runs
      (id,user_id,type,status,session_id,agent_type,created_at,started_at)
      VALUES ('analysis_debate_root',?,'debate_agent','running',?,'debate_orchestrator',?,?)`)
      .run(TEST_USER_ID, conversationId, now, now);
    db.close();
    professional.runProfessionalAdvisor.mockResolvedValueOnce({
      runId: "analysis_publication",
      status: "DEGRADED",
      direction: "HOLD",
      action: "WATCH",
      findings: [],
      missingInformation: [],
      recommendation: {
        instrumentId: "instrument_510300",
        symbol: "510300.OF",
        action: "WATCH",
        suitability: "LOW",
        summary: "当前只适合观察。",
        confidence: "0.55",
        positionRange: [],
        firstPosition: null,
        addConditions: [],
        referenceRange: [],
        stopLoss: "",
        takeProfit: "",
        horizon: "MEDIUM",
        expiresAt: "2026-08-24T00:00:00.000Z",
        reasons: ["多空证据仍未收敛"],
        counterEvidence: ["行情与估值证据不足"],
        risks: ["市场波动"],
        alternatives: ["继续观察"],
        invalidation: "新证据改变结论",
        compliance: { status: "DEGRADED", reasons: ["仅模拟"], disclaimer: "不构成交易指令" },
        dataAsOf: "2026-07-25",
        provenance: { source: "debate" },
      },
      answer: "当前只适合观察。",
      provider: "CHIEF_ADVISOR",
      debateSuggestion: {
        recommended: false,
        motion: "当前问题暂不需要继续辩论",
        reason: "发布门已经给出保守结论。",
      },
    });

    const result = await runAdvisorPublicationGate({
      userId: TEST_USER_ID,
      sessionId: conversationId,
      rootAnalysisId: "analysis_debate_root",
      content: "辩题、双方公开观点和裁判总结",
      targetSymbol: "510300.OF",
    });

    expect(result).toMatchObject({
      status: "DEGRADED",
      action: "WATCH",
      provider: "CHIEF_ADVISOR",
    });
    expect(result.recommendationId).toMatch(/^recommendation_/u);
    expect(professional.runProfessionalAdvisor).toHaveBeenCalledWith(expect.objectContaining({
      rootAnalysisId: "analysis_debate_root",
      targetSymbol: "510300.OF",
    }));

    const resultDb = getDatabase();
    const publicationRun = resultDb.prepare("SELECT parent_run_id,root_run_id,status,result_json FROM agent_runs WHERE id=?").get(result.analysisId) as Record<string, unknown>;
    const recommendation = resultDb.prepare("SELECT analysis_id,status FROM recommendations WHERE id=?").get(result.recommendationId) as Record<string, unknown>;
    resultDb.close();
    expect(publicationRun).toMatchObject({
      parent_run_id: "analysis_debate_root",
      root_run_id: "analysis_debate_root",
      status: "completed",
    });
    expect(JSON.parse(String(publicationRun.result_json))).toMatchObject({ status: "DEGRADED", action: "WATCH" });
    expect(recommendation).toEqual({ analysis_id: result.analysisId, status: "DEGRADED" });
  });
});
