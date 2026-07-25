import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TEST_USER_ID, seedAuthenticatedUser } from "@tests/helpers/auth";
import { getDatabase, isoNow } from "@/server/http/context";

const { executePandaSourcesMock, runChiefAdvisorConversationMock, runChiefAdvisorScreeningMock } = vi.hoisted(() => ({
  executePandaSourcesMock: vi.fn(),
  runChiefAdvisorConversationMock: vi.fn(),
  runChiefAdvisorScreeningMock: vi.fn(),
}));

vi.mock("@/mastra/agents/chief-advisor", () => ({
  runChiefAdvisor: vi.fn(),
  runChiefAdvisorConversation: runChiefAdvisorConversationMock,
  runChiefAdvisorScreening: runChiefAdvisorScreeningMock,
}));

vi.mock("@/server/extensions/query/panda-query-executor", async () => {
  const actual = await vi.importActual<typeof import("@/server/extensions/query/panda-query-executor")>("@/server/extensions/query/panda-query-executor");
  return { ...actual, executePandaSources: executePandaSourcesMock };
});

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
  dbPath = join(tmpdir(), `money-whisperer-professional-screening-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
  vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
  executePandaSourcesMock.mockReset();
  runChiefAdvisorConversationMock.mockReset();
  runChiefAdvisorScreeningMock.mockReset();
  seedAuthenticatedUser();
  clearDefaultHoldings();
  createCompleteProfile();
  createTechnologyCandidates();
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
});

describe("professional instrument screening", () => {
  it("routes a request to find technology stocks through verified data screening", async () => {
    createRootRun("analysis-screening");
    executePandaSourcesMock.mockImplementationOnce(async ({ sources }) => sources.map((source: Record<string, unknown>, index: number) => ({
      source,
      result: {
        data: [
          { symbol: "AAPL", date: "20260723", close: "210" },
          { symbol: "AAPL", date: "20260724", close: "220" },
          { symbol: "MSFT", date: "20260723", close: "490" },
          { symbol: "MSFT", date: "20260724", close: "500" },
        ],
        liveCallSucceeded: true,
        fresh: true,
        asOfDate: "2026-07-24",
      },
      toolCallId: `tool-${index}`,
      skillRunId: `skill-${index}`,
      marketSnapshotIds: [],
    })));
    runChiefAdvisorScreeningMock.mockResolvedValueOnce({
      answer: "我先给你两个经过行情核验的科技股研究候选：Apple 和 Microsoft。它们不是直接买入结论，选中后再做完整分析。",
      provider: "CHIEF_ADVISOR",
    });

    const result = await runProfessionalAdvisor({
      userId: TEST_USER_ID,
      sessionId: "session-screening",
      analysisId: "analysis-screening",
      content: "直接去帮我找几个现在可以研究建仓的科技个股，我有100万现金",
    });

    expect(result.kind).toBe("SCREENING");
    expect(result.recommendation).toBeNull();
    expect(result.answer).toContain("科技股研究候选");
    expect(executePandaSourcesMock).toHaveBeenCalled();
    expect(runChiefAdvisorScreeningMock).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({
        candidates: expect.arrayContaining([
          expect.objectContaining({ symbol: "AAPL" }),
          expect.objectContaining({ symbol: "MSFT" }),
        ]),
      }),
    }));
    expect(runChiefAdvisorConversationMock).not.toHaveBeenCalled();
  });

  it("prefers multi-candidate screening over single-instrument buy routing", async () => {
    createRootRun("analysis-screening-buy-word");
    executePandaSourcesMock.mockResolvedValueOnce([]);
    runChiefAdvisorScreeningMock.mockResolvedValueOnce({
      answer: "我会先筛出少量科技股研究候选，再逐个完成完整分析。",
      provider: "CHIEF_ADVISOR",
    });

    const result = await runProfessionalAdvisor({
      userId: TEST_USER_ID,
      sessionId: "session-screening",
      analysisId: "analysis-screening-buy-word",
      content: "帮我推荐几个可以买入的科技股",
    });

    expect(result.kind).toBe("SCREENING");
    expect(result.missingInformation).not.toContain("instrument");
    expect(runChiefAdvisorScreeningMock).toHaveBeenCalled();
  });

  it("keeps consecutive short follow-ups in the prior screening workflow", async () => {
    createRootRun("analysis-screening-follow-up");
    createUserMessage("先帮我找几个适合研究建仓的科技个股");
    createUserMessage("直接开始分析");
    executePandaSourcesMock.mockResolvedValueOnce([]);
    runChiefAdvisorScreeningMock.mockResolvedValueOnce({
      answer: "收到，我按长线视角继续筛选，并优先关注波动、回撤和持仓重叠风险。",
      provider: "CHIEF_ADVISOR",
    });

    const result = await runProfessionalAdvisor({
      userId: TEST_USER_ID,
      sessionId: "session-screening",
      analysisId: "analysis-screening-follow-up",
      content: "长线投资",
    });

    expect(result.kind).toBe("SCREENING");
    expect(runChiefAdvisorScreeningMock).toHaveBeenCalled();
    expect(runChiefAdvisorConversationMock).not.toHaveBeenCalled();
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
    VALUES ('profile-screening',?,'BALANCED','1000000','LONG','0.12',?,'completed',1,?,?)`).run(
    TEST_USER_ID,
    JSON.stringify({ instrumentPreference: "STOCK", nearTermUse: false }),
    now,
    now,
  );
  db.close();
}

function clearDefaultHoldings(): void {
  const db = getDatabase();
  db.prepare("DELETE FROM holding_snapshots WHERE portfolio_snapshot_id IN (SELECT id FROM portfolio_snapshots WHERE user_id=?)").run(TEST_USER_ID);
  db.prepare("DELETE FROM holdings WHERE user_id=?").run(TEST_USER_ID);
  db.prepare("DELETE FROM portfolio_snapshots WHERE user_id=?").run(TEST_USER_ID);
  db.close();
}

function createTechnologyCandidates(): void {
  const db = getDatabase();
  db.prepare("UPDATE instruments SET sector='Technology',tradable=1 WHERE id IN ('AAPL','MSFT')").run();
  db.close();
}

function createUserMessage(content: string): void {
  const db = getDatabase();
  db.prepare(`INSERT INTO messages
    (id,session_id,role,content,created_at,metadata_json)
    VALUES (?,?,'user',?,?,'{}')`).run(randomUUID(), "session-screening", content, isoNow());
  db.close();
}
