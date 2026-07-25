import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TEST_USER_ID, seedAuthenticatedUser } from "@tests/helpers/auth";
import { getDatabase, isoNow } from "@/server/http/context";

const { runChiefAdvisorMock } = vi.hoisted(() => ({
  runChiefAdvisorMock: vi.fn(),
}));

vi.mock("@/mastra/agents/chief-advisor", () => ({
  runChiefAdvisor: runChiefAdvisorMock,
}));

vi.mock("@/server/extensions/advisor/semantic-tools", async () => {
  const actual = await vi.importActual<typeof import("./semantic-tools")>("@/server/extensions/advisor/semantic-tools");
  return {
    ...actual,
    loadAdvisorSemanticToolsContext: vi.fn(async () => ({
      available: true,
      domains: [],
      tables: [],
      columns: [],
      toolCallIds: [],
    })),
  };
});

import { runProfessionalAdvisor } from "./professional";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-professional-routing-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
  vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
  runChiefAdvisorMock.mockReset();
  seedAuthenticatedUser();
  const db = getDatabase();
  db.prepare("DELETE FROM holding_snapshots WHERE portfolio_snapshot_id IN (SELECT id FROM portfolio_snapshots WHERE user_id=?)").run(TEST_USER_ID);
  db.prepare("DELETE FROM holdings WHERE user_id=?").run(TEST_USER_ID);
  db.prepare("DELETE FROM portfolio_snapshots WHERE user_id=?").run(TEST_USER_ID);
  db.close();
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* SQLite may release handles after teardown. */ }
  }
});

describe("runProfessionalAdvisor routing", () => {
  it("routes complete-profile normal planning questions to Chief Advisor with profile context", async () => {
    createRootRun("analysis-complete-profile");
    createCompleteProfile();
    runChiefAdvisorMock.mockResolvedValueOnce({
      decision: {
        action: "WATCH",
        requestedDirection: "HOLD",
        summary: "基于完整画像，先按应急、稳健和长期增值三层安排资金。",
        suitability: "MEDIUM",
        confidence: 0.82,
        rationales: ["用户画像完整，可直接给出资金规划边界"],
        counterEvidence: ["资金用途变化会改变分层比例"],
        risks: ["市场波动仍可能影响长期资产"],
        portfolioImpact: "本轮不涉及新增或卖出具体标的",
        invalidationConditions: ["收入、目标或回撤边界变化"],
        compliance: { approved: true, decision: "APPROVED", reason: "普通规划问题不需要具体标的" },
      },
      findings: modelFindings(),
      delegatedAgents: ["PROFILE_CONTEXT", "PORTFOLIO_RISK", "COMPLIANCE_REVIEWER", "EXPLANATION_REPORT"],
      fallbackAgents: [],
    });

    const result = await runProfessionalAdvisor({
      userId: TEST_USER_ID,
      sessionId: "session-routing",
      analysisId: "analysis-complete-profile",
      content: "我该如何做资产配置和资金规划？",
    });

    expect(result.kind).toBe("DECISION");
    expect(result.provider).toBe("CHIEF_ADVISOR");
    expect(result.missingInformation).not.toContain("instrument");
    expect(result.answer).toContain("完整画像");
    expect(result.answer).toContain("安排资金");
    expect(runChiefAdvisorMock).toHaveBeenCalledTimes(1);
    const call = runChiefAdvisorMock.mock.calls[0][0];
    expect(call.requiredAgents).not.toContain("DATA_RESEARCH");
    expect(call.context.profile).toEqual(expect.objectContaining({
      risk_level: "BALANCED",
      investment_amount_decimal: "20000",
      horizon: "LONG",
      max_drawdown_decimal: "0.12",
    }));
    expect(call.context.profileCompleteness).toEqual({ complete: true, missing: [] });
    expect(call.prompt).toContain("complete=true 时这些画像字段已知");
    expect(call.prompt).toContain("无标的的一般理财/资产配置/资金规划问题不得要求补充 instrument");
  });

  it("keeps incomplete open-ended normal questions in guided intake", async () => {
    createRootRun("analysis-incomplete-profile");

    const result = await runProfessionalAdvisor({
      userId: TEST_USER_ID,
      sessionId: "session-routing",
      analysisId: "analysis-incomplete-profile",
      content: "我刚开始理财，不知道该怎么安排资金",
    });

    expect(result.kind).toBe("GUIDED_INTAKE");
    expect(result.provider).toBe("DETERMINISTIC_FALLBACK");
    expect(result.answer).toContain("先确认两件事");
    expect(runChiefAdvisorMock).not.toHaveBeenCalled();
  });
});

function createRootRun(id: string): void {
  const db = getDatabase();
  db.prepare("INSERT INTO agent_runs (id,user_id,type,status,created_at) VALUES (?,?,?,'running',?)")
    .run(id, TEST_USER_ID, "conversation_agent", isoNow());
  db.close();
}

function createCompleteProfile(): void {
  const db = getDatabase();
  const now = isoNow();
  db.prepare(`INSERT INTO user_profiles
    (id,user_id,risk_level,investment_amount_decimal,horizon,max_drawdown_decimal,preferences_json,status,version,created_at,updated_at)
    VALUES ('profile-routing',?,'BALANCED','20000','LONG','0.12',?,'completed',1,?,?)`).run(
    TEST_USER_ID,
    JSON.stringify({ instrumentPreference: "BROAD_INDEX_ETF", nearTermUse: false }),
    now,
    now,
  );
  db.close();
}

function modelFindings() {
  return [{
    agent: "PROFILE_CONTEXT",
    conclusion: "已加载完整画像",
    supportEvidence: ["风险等级 BALANCED", "期限 LONG"],
    counterEvidence: ["画像变化会影响建议"],
    missingInformation: [],
    risks: ["资金用途变化"],
    confidence: 0.9,
    needsAnotherAgent: true,
    suggestedNextAgent: "PORTFOLIO_RISK",
  }, {
    agent: "PORTFOLIO_RISK",
    conclusion: "本轮为无标的普通规划问题，不需要行情数据",
    supportEvidence: ["无交易动作"],
    counterEvidence: ["未提供当前持仓时不能做持仓诊断"],
    missingInformation: [],
    risks: ["未来目标变化"],
    confidence: 0.78,
    needsAnotherAgent: true,
    suggestedNextAgent: "COMPLIANCE_REVIEWER",
  }, {
    agent: "COMPLIANCE_REVIEWER",
    conclusion: "普通规划回答通过合规检查",
    supportEvidence: ["不包含具体交易指令"],
    counterEvidence: ["执行前仍需复核"],
    missingInformation: [],
    risks: ["非实盘指令"],
    confidence: 0.92,
    needsAnotherAgent: false,
  }, {
    agent: "EXPLANATION_REPORT",
    conclusion: "已整理为公开回答",
    supportEvidence: ["画像完整"],
    counterEvidence: ["目标变化会改变结论"],
    missingInformation: [],
    risks: ["仅供研究"],
    confidence: 0.82,
    needsAnotherAgent: false,
  }];
}
