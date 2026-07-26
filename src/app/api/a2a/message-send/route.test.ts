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
  runAdvisorPublicationGate: vi.fn(),
}));

import { POST } from "./route";
import { POST as POSTStream } from "@/app/api/a2a/message:stream/route";
import { resetA2ARateLimitsForTests } from "@/server/a2a/auth";
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
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
});

describe("A2A message gateway", () => {
  it("rejects requests without bearer auth", async () => {
    const response = await POST(request(advisorBody()));
    expect(response.status).toBe(401);
  });

  it("rejects database clients without the requested capability", async () => {
    const client = createDatabaseClient(["tasks_read"]);
    const response = await POST(request(advisorBody(), client.token));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "CAPABILITY_NOT_ALLOWED" } });
    expect(runConversationAgentMock).not.toHaveBeenCalled();
  });

  it("runs scoped clients under an isolated non-login execution principal", async () => {
    const client = createDatabaseClient([
      "chief_advisor_conversation",
      "tasks_read",
      "tasks_cancel",
    ]);
    runConversationAgentMock.mockResolvedValueOnce(completedAdvisor());

    const response = await POST(request(advisorBody(), client.token));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      task: {
        contextId: "remote-context-1",
        status: { state: "TASK_STATE_COMPLETED" },
        metadata: { capabilityId: "chief_advisor_conversation" },
      },
    });
    expect(Object.keys(body)).toEqual(["task"]);
    expect(body.task.status.message.parts[0].text).toContain("Risk notice");
    expect(runConversationAgentMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: expect.stringMatching(/^a2a_exec_/u),
      sessionId: "remote-context-1:advisor",
      clientMessageId: "remote-message-1",
    }));

    const db = getDatabase();
    const context = db.prepare(`SELECT c.execution_user_id,u.username,u.password_hash
      FROM a2a_contexts c JOIN users u ON u.id=c.execution_user_id
      WHERE c.id=? AND c.external_client_id=?`).get("remote-context-1", client.client.id);
    db.close();
    expect(context).toMatchObject({ username: null, password_hash: null });
  });

  it("supports JSON-RPC task aliases after message/send", async () => {
    const client = createDatabaseClient(["chief_advisor_conversation", "tasks_read"]);
    runConversationAgentMock.mockResolvedValueOnce(completedAdvisor());
    const sent = await POST(request({
      jsonrpc: "2.0",
      id: "rpc-send",
      method: "message/send",
      params: advisorBody(),
    }, client.token));
    const sentBody = await sent.json();
    const taskId = sentBody.result.task.id;
    expect(Object.keys(sentBody.result)).toEqual(["task"]);

    const fetched = await POST(request({
      jsonrpc: "2.0",
      id: "rpc-get",
      method: "GetTask",
      params: { id: taskId },
    }, client.token));

    expect(await fetched.json()).toMatchObject({
      jsonrpc: "2.0",
      id: "rpc-get",
      result: { id: taskId, status: { state: "TASK_STATE_COMPLETED" } },
    });
  });

  it("keeps the legacy bearer token compatible with the unified gateway", async () => {
    vi.stubEnv("A2A_BEARER_TOKEN", "legacy-secret");
    runConversationAgentMock.mockResolvedValueOnce(completedAdvisor());

    const response = await POST(request(advisorBody(), "legacy-secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      task: {
        status: { state: "TASK_STATE_COMPLETED" },
        metadata: { capabilityId: "chief_advisor_conversation" },
      },
    });
  });

  it("streams A2A task updates through the HTTP+JSON streaming endpoint", async () => {
    const client = createDatabaseClient(["chief_advisor_conversation"]);
    runConversationAgentMock.mockResolvedValueOnce(completedAdvisor());

    const response = await POSTStream(request(
      advisorBody(),
      client.token,
      "/api/a2a/message:stream",
    ));
    const body = await response.text();
    const events = body
      .trim()
      .split("\n\n")
      .filter(Boolean)
      .map((event) => JSON.parse(event.replace(/^data: /u, "")) as Record<string, unknown>);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      task: {
        status: { state: "TASK_STATE_COMPLETED" },
      },
    });
    expect(Object.keys(events[0])).toEqual(["task"]);
  });

  it("streams JSON-RPC SendStreamingMessage responses through SSE", async () => {
    const client = createDatabaseClient(["chief_advisor_conversation"]);
    runConversationAgentMock.mockResolvedValueOnce(completedAdvisor());

    const response = await POST(request({
      jsonrpc: "2.0",
      id: "rpc-stream-1",
      method: "SendStreamingMessage",
      params: advisorBody(),
    }, client.token));
    const body = await response.text();
    const events = body
      .trim()
      .split("\n\n")
      .filter(Boolean)
      .map((event) => JSON.parse(event.replace(/^data: /u, "")) as Record<string, unknown>);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      jsonrpc: "2.0",
      id: "rpc-stream-1",
      result: {
        task: {
          status: { state: "TASK_STATE_COMPLETED" },
        },
      },
    });
  });

  it("emits status and artifact updates for a slow streaming task", async () => {
    vi.stubEnv("A2A_INITIAL_RESPONSE_TIMEOUT_MS", "5");
    vi.stubEnv("A2A_STREAM_MAX_DURATION_MS", "2000");
    const client = createDatabaseClient(["chief_advisor_conversation"]);
    runConversationAgentMock.mockImplementationOnce(
      () => new Promise((resolve) => {
        setTimeout(() => resolve(completedAdvisor()), 300);
      }),
    );

    const response = await POSTStream(request(
      advisorBody(),
      client.token,
      "/api/a2a/message:stream",
    ));
    const body = await response.text();
    const events = body
      .trim()
      .split("\n\n")
      .filter(Boolean)
      .map((event) => JSON.parse(event.replace(/^data: /u, "")) as Record<string, unknown>);

    expect(response.status).toBe(200);
    expect(events.map((event) => Object.keys(event))).toEqual([
      ["task"],
      ["artifactUpdate"],
      ["statusUpdate"],
    ]);
    expect(events.at(-1)?.statusUpdate).toMatchObject({
      status: { state: "TASK_STATE_COMPLETED" },
    });
  });
});

function advisorBody() {
  return {
    message: {
      kind: "message",
      role: "user",
      messageId: "remote-message-1",
      contextId: "remote-context-1",
      parts: [{ kind: "text", text: "Analyze AAPL current add-on suitability" }],
      metadata: {
        capabilityId: "chief_advisor_conversation",
        operation: "send",
      },
    },
  };
}

function completedAdvisor() {
  return {
    messageId: "user-message-1",
    assistantMessageId: "assistant-message-1",
    analysis: { analysisId: "analysis-1", status: "COMPLETED" },
    answer: "Conclusion: do not add yet.",
    recommendationId: "recommendation-1",
    missingQuestions: [],
    dataQueryId: null,
    outputMode: "SQL_ONLY",
  };
}

function request(body: unknown, bearer?: string, path = "/api/a2a/message-send"): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (bearer) headers.set("authorization", `Bearer ${bearer}`);
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function createDatabaseClient(capabilities: Parameters<typeof createExternalClient>[1]["capabilities"]) {
  const actorUserId = "a2a-admin";
  const now = isoNow();
  const db = getDatabase();
  db.prepare(`INSERT OR IGNORE INTO users
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
    name: `Database client ${randomUUID()}`,
    capabilities,
    rateLimitPerMinute: 60,
  });
}
