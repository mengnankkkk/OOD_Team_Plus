import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prepareDatabase } from "@/server/db/migration-runner";
import { createA2ATask } from "../task-service";
import type { A2AContextView, ExternalClientPrincipal } from "../contracts";

const { runConversationAgent } = vi.hoisted(() => ({
  runConversationAgent: vi.fn(),
}));

vi.mock("@/server/extensions/advisor/service", () => ({
  runConversationAgent,
}));

import { runAdvisorCapability } from "./advisor";

describe("A2A Chief Advisor adapter", () => {
  beforeEach(() => {
    vi.stubEnv("DB_PATH", `/tmp/a2a-advisor-${crypto.randomUUID()}.db`);
    seed();
    runConversationAgent.mockReset().mockResolvedValue({
      messageId: "user-message",
      assistantMessageId: "assistant-message",
      analysis: { analysisId: "analysis-1", status: "COMPLETED" },
      answer: "Portfolio concentration is high.",
      recommendationId: null,
      missingQuestions: [],
      outputMode: "SQL_ONLY",
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("runs the Chief Advisor under the context execution principal", async () => {
    const task = createA2ATask({
      externalClientId: "client-1",
      contextId: "context-1",
      capabilityId: "chief_advisor_conversation",
      operation: "send",
      clientMessageId: "message-1",
      input: { text: "Review my portfolio" },
    }).task;

    const result = await runAdvisorCapability({
      principal: principal(),
      task,
      context: context(),
      messageId: "message-1",
      text: "Review my portfolio",
      operation: "send",
      input: {},
      acceptedOutputModes: [],
    });

    expect(runConversationAgent).toHaveBeenCalledWith(expect.objectContaining({
      userId: "exec-1",
      content: "Review my portfolio",
    }));
    expect(result.status).toBe("completed");
    expect(result.result?.artifacts[0].name).toBe("advisor_result");
  });
});

function seed(): void {
  const db = new Database(process.env.DB_PATH!);
  prepareDatabase(db as never, process.env.DB_PATH!);
  const now = "2026-07-25T00:00:00.000Z";
  db.prepare("INSERT INTO users (id,display_name,created_at) VALUES ('admin','Admin',?)").run(now);
  db.prepare("INSERT INTO users (id,display_name,created_at) VALUES ('exec-1','External',?)").run(now);
  db.prepare(`INSERT INTO a2a_external_clients
    (id,name,status,capabilities_json,rate_limit_per_minute,created_by_user_id,created_at,updated_at,row_version)
    VALUES ('client-1','Client','ACTIVE','[]',60,'admin',?,?,1)`).run(now, now);
  db.prepare(`INSERT INTO a2a_contexts
    (id,external_client_id,execution_user_id,primary_capability,created_at,updated_at,expires_at)
    VALUES ('context-1','client-1','exec-1','chief_advisor_conversation',?,?,?)`).run(
    now,
    now,
    "2026-08-24T00:00:00.000Z",
  );
  db.close();
}

function principal(): ExternalClientPrincipal {
  return { clientId: "client-1", name: "Client", capabilities: ["chief_advisor_conversation"], rateLimitPerMinute: 60 };
}

function context(): A2AContextView {
  return {
    id: "context-1", externalClientId: "client-1", executionUserId: "exec-1",
    primaryCapability: "chief_advisor_conversation", status: "ACTIVE", profile: {}, goals: [],
    portfolioInput: null, portfolioSnapshotId: null, createdAt: "", updatedAt: "", expiresAt: "2026-08-24T00:00:00.000Z",
  };
}
