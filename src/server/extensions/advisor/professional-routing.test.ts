import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TEST_USER_ID, seedAuthenticatedUser } from "@tests/helpers/auth";
import { getDatabase, isoNow } from "@/server/http/context";

const { runChiefAdvisorConversationMock, runChiefAdvisorMock } = vi.hoisted(() => ({
  runChiefAdvisorConversationMock: vi.fn(),
  runChiefAdvisorMock: vi.fn(),
}));

vi.mock("@/mastra/agents/chief-advisor", () => ({
  runChiefAdvisorConversation: runChiefAdvisorConversationMock,
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
  runChiefAdvisorConversationMock.mockReset();
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
  it("routes greetings to Chief Advisor conversation without professional specialists", async () => {
    createRootRun("analysis-greeting");
    createCompleteProfile();
    runChiefAdvisorConversationMock.mockResolvedValueOnce({
      answer: "你好，我是你的理财顾问。你可以先告诉我最近最想解决的一件财务问题。",
      provider: "CHIEF_ADVISOR",
    });

    const result = await runProfessionalAdvisor({
      userId: TEST_USER_ID,
      sessionId: "session-routing",
      analysisId: "analysis-greeting",
      content: "你好",
    });

    expect(result.kind).toBe("CONVERSATION");
    expect(result.provider).toBe("CHIEF_ADVISOR");
    expect(result.recommendation).toBeNull();
    expect(result.findings).toEqual([]);
    expect(result.answer).toContain("理财顾问");
    expect(runChiefAdvisorConversationMock).toHaveBeenCalledTimes(1);
    expect(runChiefAdvisorMock).not.toHaveBeenCalled();
    expect(runChiefAdvisorConversationMock.mock.calls[0][0].context.profile).toEqual(expect.objectContaining({
      risk_level: "BALANCED",
      investment_amount_decimal: "20000",
    }));
  });

  it("routes complete-profile normal follow-up questions to Chief Advisor conversation with profile context", async () => {
    createRootRun("analysis-complete-profile");
    createCompleteProfile();
    runChiefAdvisorConversationMock.mockResolvedValueOnce({
      answer: "市场波动本身不是结论。结合你的长期目标，我们先看这笔钱的使用期限和你真正担心的情景。",
      provider: "CHIEF_ADVISOR",
    });

    const result = await runProfessionalAdvisor({
      userId: TEST_USER_ID,
      sessionId: "session-routing",
      analysisId: "analysis-complete-profile",
      content: "我该怎样理解当前市场波动？",
    });

    expect(result.kind).toBe("CONVERSATION");
    expect(result.provider).toBe("CHIEF_ADVISOR");
    expect(result.missingInformation).not.toContain("instrument");
    expect(result.answer).toContain("市场波动");
    expect(runChiefAdvisorConversationMock).toHaveBeenCalledTimes(1);
    expect(runChiefAdvisorMock).not.toHaveBeenCalled();
    const call = runChiefAdvisorConversationMock.mock.calls[0][0];
    expect(call.context.profile).toEqual(expect.objectContaining({
      risk_level: "BALANCED",
      investment_amount_decimal: "20000",
      horizon: "LONG",
      max_drawdown_decimal: "0.12",
    }));
    expect(call.context.profileCompleteness).toEqual({ complete: true, missing: [] });
  });

  it("lets Chief Advisor guide incomplete-profile open-ended conversations", async () => {
    createRootRun("analysis-incomplete-profile");
    runChiefAdvisorConversationMock.mockResolvedValueOnce({
      answer: "担心波动很正常。先告诉我这笔钱大概多久不会使用，我会按你的承受范围一步步梳理。",
      provider: "CHIEF_ADVISOR",
    });

    const result = await runProfessionalAdvisor({
      userId: TEST_USER_ID,
      sessionId: "session-routing",
      analysisId: "analysis-incomplete-profile",
      content: "我最近总是担心波动",
    });

    expect(result.kind).toBe("CONVERSATION");
    expect(result.provider).toBe("CHIEF_ADVISOR");
    expect(result.answer).toContain("一步步梳理");
    expect(runChiefAdvisorConversationMock).toHaveBeenCalledTimes(1);
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
