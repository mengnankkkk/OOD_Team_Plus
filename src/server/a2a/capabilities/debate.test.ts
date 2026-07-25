import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prepareDatabase } from "@/server/db/migration-runner";

const debate = vi.hoisted(() => ({
  startDebate: vi.fn().mockResolvedValue({
    debateSessionId: "debate-1",
    roundId: "round-1",
    roundIndex: 1,
    analysis: { analysisId: "analysis-1", status: "COMPLETED" },
    judgement: {
      bullStrongestPoint: "Growth",
      bearStrongestPoint: "Valuation",
      whyNotFinal: "Needs monitoring",
    },
    publication: null,
  }),
  continueDebate: vi.fn().mockResolvedValue({
    debateSessionId: "debate-1",
    roundId: "round-2",
    roundIndex: 2,
    analysis: { analysisId: "analysis-1", status: "COMPLETED" },
    judgement: {
      bullStrongestPoint: "Growth",
      bearStrongestPoint: "Valuation",
      whyNotFinal: "Needs monitoring",
    },
    publication: null,
  }),
  buildDebateChiefAdvisorPrompt: vi.fn(),
}));

vi.mock("@/server/extensions/debate/service", () => debate);
vi.mock("../task-service", () => ({
  startA2ATask: vi.fn((_clientId, _taskId) => task("working")),
  completeA2ATask: vi.fn((_clientId, _taskId, result) => ({ ...task("completed"), result })),
  setA2ATaskDomainResource: vi.fn((_clientId, _taskId, type, id) => ({
    ...task("working"),
    domainResourceType: type,
    domainResourceId: id,
  })),
}));

import { runDebateCapability } from "./debate";

describe("A2A debate adapter", () => {
  beforeEach(() => {
    vi.stubEnv("DB_PATH", `/tmp/a2a-debate-${crypto.randomUUID()}.db`);
    const db = new Database(process.env.DB_PATH!);
    prepareDatabase(db as never, process.env.DB_PATH!);
    const now = "2026-07-25T00:00:00.000Z";
    db.prepare("INSERT INTO users (id,display_name,created_at) VALUES ('exec-1','External',?)")
      .run(now);
    db.prepare(`INSERT INTO conversation_sessions
      (id,user_id,title,status,created_at,updated_at,row_version)
      VALUES ('context-1:debate','exec-1','Debate','active',?,?,1)`).run(now, now);
    db.prepare(`INSERT INTO agent_runs
      (id,user_id,session_id,type,status,created_at,completed_at)
      VALUES ('analysis-1','exec-1','context-1:debate','debate','completed',?,?)`)
      .run(now, now);
    db.prepare(`INSERT INTO debate_sessions
      (id,user_id,conversation_id,root_agent_run_id,motion,target_symbol,user_debate_role,status,current_round_index,created_at,updated_at)
      VALUES ('debate-1','exec-1','context-1:debate','analysis-1','AAPL debate','AAPL','neutral','active',1,?,?)`)
      .run(now, now);
    db.close();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("starts a stateful debate with the context execution principal", async () => {
    const result = await runDebateCapability({
      principal: { clientId: "client-1", name: "Client", capabilities: ["debate_mode"], rateLimitPerMinute: 60 },
      task: task("submitted"),
      context: {
        id: "context-1", externalClientId: "client-1", executionUserId: "exec-1",
        primaryCapability: "debate_mode", status: "ACTIVE", profile: {}, goals: [],
        portfolioInput: null, portfolioSnapshotId: null, createdAt: "", updatedAt: "", expiresAt: "",
      },
      messageId: "message-1",
      text: "Should I add AAPL?",
      operation: "start",
      input: { targetSymbol: "AAPL" },
      acceptedOutputModes: [],
    });

    expect(debate.startDebate).toHaveBeenCalledWith(expect.objectContaining({ userId: "exec-1" }));
    expect(result.result?.artifacts[0]).toMatchObject({
      name: "debate_round",
      data: { debateSessionId: "debate-1", roundIndex: 1 },
    });
  });

  it("routes a direct bear question with BEAR speaking before BULL", async () => {
    await runDebateCapability({
      principal: { clientId: "client-1", name: "Client", capabilities: ["debate_mode"], rateLimitPerMinute: 60 },
      task: { ...task("submitted"), operation: "question_bear" },
      context: {
        id: "context-1", externalClientId: "client-1", executionUserId: "exec-1",
        primaryCapability: "debate_mode", status: "ACTIVE", profile: {}, goals: [],
        portfolioInput: null, portfolioSnapshotId: null, createdAt: "", updatedAt: "", expiresAt: "",
      },
      messageId: "message-2",
      text: "Bear, explain the valuation risk.",
      operation: "question_bear",
      input: { debateSessionId: "debate-1" },
      acceptedOutputModes: [],
    });

    expect(debate.continueDebate).toHaveBeenCalledWith(expect.objectContaining({
      preferredFirstSpeaker: "bear",
    }));
  });

  it("rejects unknown debate operations", async () => {
    await expect(runDebateCapability({
      principal: { clientId: "client-1", name: "Client", capabilities: ["debate_mode"], rateLimitPerMinute: 60 },
      task: { ...task("submitted"), operation: "unknown" },
      context: {
        id: "context-1", externalClientId: "client-1", executionUserId: "exec-1",
        primaryCapability: "debate_mode", status: "ACTIVE", profile: {}, goals: [],
        portfolioInput: null, portfolioSnapshotId: null, createdAt: "", updatedAt: "", expiresAt: "",
      },
      messageId: "message-3",
      text: "Unknown",
      operation: "unknown",
      input: {},
      acceptedOutputModes: [],
    })).rejects.toMatchObject({ code: "INVALID_OPERATION", status: 422 });
  });
});

function task(status: "submitted" | "working" | "completed") {
  return {
    id: "task-1", externalClientId: "client-1", contextId: "context-1",
    capabilityId: "debate_mode" as const, operation: "start", status,
    domainResourceType: null, domainResourceId: null, result: null, error: null,
    createdAt: "", startedAt: null, completedAt: null, events: [],
  };
}
