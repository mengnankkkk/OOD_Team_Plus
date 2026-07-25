import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runConversationAgentMock } = vi.hoisted(() => ({
  runConversationAgentMock: vi.fn(),
}));

vi.mock("@/server/extensions/advisor/service", () => ({
  runConversationAgent: runConversationAgentMock,
}));

import { POST } from "./route";
import {
  A2A_SERVICE_USER_ID,
  resetA2ARateLimitsForTests,
} from "@/server/a2a/auth";
import { createExternalClient } from "@/server/a2a/client-service";
import { getDatabase, isoNow } from "@/server/http/context";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-a2a-message-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
  vi.stubEnv("A2A_BEARER_TOKEN", "");
  runConversationAgentMock.mockReset();
  resetA2ARateLimitsForTests();
});

afterEach(() => {
  resetA2ARateLimitsForTests();
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

describe("A2A message send", () => {
  it("rejects requests without bearer auth", async () => {
    vi.stubEnv("A2A_BEARER_TOKEN", "secret");
    const response = await POST(jsonRequest({ message: { parts: [{ kind: "text", text: "分析 AAPL" }] } }));
    expect(response.status).toBe(401);
  });

  it("rejects database clients without chief advisor scope", async () => {
    const created = createDatabaseClient(["tasks_read"]);

    const response = await POST(jsonRequest({
      message: { parts: [{ kind: "text", text: "分析 AAPL" }] },
    }, created.token));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "CAPABILITY_NOT_ALLOWED" },
    });
    expect(runConversationAgentMock).not.toHaveBeenCalled();
  });

  it("returns gateway-not-ready without creating shared legacy data for scoped database clients", async () => {
    const created = createDatabaseClient(["chief_advisor_conversation"]);
    runConversationAgentMock.mockResolvedValueOnce({
      analysis: { analysisId: "should-not-run", status: "COMPLETED" },
      answer: "should not run",
    });
    const before = sharedLegacyCounts();

    const response = await POST(jsonRequest({
      message: {
        messageId: "database-client-message",
        contextId: "database-client-context",
        parts: [{ kind: "text", text: "分析 AAPL" }],
      },
    }, created.token));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "A2A_GATEWAY_NOT_READY" },
    });
    expect(runConversationAgentMock).not.toHaveBeenCalled();
    expect(sharedLegacyCounts()).toEqual(before);
  });

  it("runs the advisor and returns an A2A task", async () => {
    vi.stubEnv("A2A_BEARER_TOKEN", "secret");
    runConversationAgentMock.mockResolvedValueOnce({
      messageId: "user-message-1",
      assistantMessageId: "assistant-message-1",
      analysis: { analysisId: "analysis-1", status: "COMPLETED", streamUrl: "/api/v1/analyses/analysis-1/events" },
      answer: "结论：暂不加仓。",
      recommendationId: "recommendation-1",
      missingQuestions: [],
      dataQueryId: null,
      outputMode: "SQL_ONLY",
    });

    const response = await POST(jsonRequest({
      message: {
        kind: "message",
        role: "user",
        messageId: "remote-message-1",
        contextId: "remote-context-1",
        parts: [{ kind: "text", text: "分析 AAPL 当前是否适合加仓" }],
      },
    }, "secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      kind: "task",
      id: "analysis-1",
      contextId: "remote-context-1",
      status: { state: "completed" },
      artifacts: [{ artifactId: "recommendation-1" }],
    });
    expect(body.status.message.parts[0].text).toContain("风险提示");
    expect(runConversationAgentMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: "a2a-remote-agent",
      sessionId: "remote-context-1",
      content: "分析 AAPL 当前是否适合加仓",
      clientMessageId: "remote-message-1",
    }));
  });

  it("accepts JSON-RPC message/send envelopes", async () => {
    vi.stubEnv("A2A_BEARER_TOKEN", "secret");
    runConversationAgentMock.mockResolvedValueOnce({
      messageId: "user-message-2",
      assistantMessageId: "assistant-message-2",
      analysis: { analysisId: "analysis-2", status: "WAITING_FOR_USER" },
      answer: "在给出交易倾向前还缺少关键信息。",
      recommendationId: null,
      missingQuestions: ["你能接受的风险等级是稳健、平衡还是进取？"],
      dataQueryId: null,
      outputMode: "SQL_ONLY",
    });

    const response = await POST(jsonRequest({
      jsonrpc: "2.0",
      id: "rpc-1",
      method: "message/send",
      params: {
        message: {
          kind: "message",
          role: "user",
          messageId: "remote-message-2",
          parts: [{ kind: "text", text: "帮我评估当前组合风险" }],
        },
      },
    }, "secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: "rpc-1",
      result: {
        kind: "task",
        id: "analysis-2",
        status: { state: "input-required" },
      },
    });
  });
});

function jsonRequest(body: unknown, bearer?: string): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (bearer) headers.set("authorization", `Bearer ${bearer}`);
  return new NextRequest("http://localhost/api/a2a/message-send", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function createDatabaseClient(capabilities: Parameters<typeof createExternalClient>[1]["capabilities"]) {
  const actorUserId = "a2a-admin";
  const now = isoNow();
  const db = getDatabase();
  db.prepare(`INSERT INTO users
    (id,username,username_normalized,display_name,role,status,force_password_change,created_at,updated_at,row_version)
    VALUES (?,?,?,?, 'ADMIN','ACTIVE',0,?,?,1)`).run(
    actorUserId,
    actorUserId,
    actorUserId,
    "A2A Admin",
    now,
    now,
  );
  db.close();
  return createExternalClient(actorUserId, {
    name: "Database client",
    capabilities,
    rateLimitPerMinute: 60,
  });
}

function sharedLegacyCounts() {
  const db = getDatabase();
  const counts = {
    users: (db.prepare("SELECT count(*) AS count FROM users WHERE id=?").get(
      A2A_SERVICE_USER_ID,
    ) as { count: number }).count,
    contexts: (db.prepare(
      "SELECT count(*) AS count FROM conversation_sessions WHERE user_id=?",
    ).get(A2A_SERVICE_USER_ID) as { count: number }).count,
    agentRuns: (db.prepare(
      "SELECT count(*) AS count FROM agent_runs WHERE user_id=?",
    ).get(A2A_SERVICE_USER_ID) as { count: number }).count,
  };
  db.close();
  return counts;
}
