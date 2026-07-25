import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prepareDatabase } from "@/server/db/migration-runner";
import {
  A2APublicError,
  type CapabilityAdapter,
  type CapabilityId,
  type ExternalClientPrincipal,
} from "./contracts";
import { completeA2ATask, listA2ATasks } from "./task-service";
import { executeA2ACommand } from "./gateway";

describe("A2A capability gateway", () => {
  beforeEach(() => {
    const path = `/tmp/a2a-gateway-${crypto.randomUUID()}.db`;
    vi.stubEnv("DB_PATH", path);
    const db = new Database(path);
    prepareDatabase(db as never, path);
    const now = "2026-07-25T00:00:00.000Z";
    db.prepare("INSERT INTO users (id,display_name,created_at) VALUES ('admin','Admin',?)").run(now);
    db.prepare(`INSERT INTO a2a_external_clients
      (id,name,status,capabilities_json,rate_limit_per_minute,created_by_user_id,created_at,updated_at,row_version)
      VALUES ('client-1','Client','ACTIVE','[]',60,'admin',?,?,1)`).run(now, now);
    db.prepare("INSERT INTO users (id,display_name,created_at) VALUES ('exec-foreign','Foreign',?)")
      .run(now);
    db.prepare(`INSERT INTO a2a_external_clients
      (id,name,status,capabilities_json,rate_limit_per_minute,created_by_user_id,created_at,updated_at,row_version)
      VALUES ('client-2','Foreign Client','ACTIVE','[]',60,'admin',?,?,1)`).run(now, now);
    db.prepare(`INSERT INTO a2a_contexts
      (id,external_client_id,execution_user_id,primary_capability,created_at,updated_at,expires_at)
      VALUES ('foreign-context','client-2','exec-foreign','chief_advisor_conversation',?,?,?)`)
      .run(now, now, "2026-08-24T00:00:00.000Z");
    db.close();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates an isolated context and dispatches the requested capability", async () => {
    const run = vi.fn(async ({ principal, task }: Parameters<CapabilityAdapter["run"]>[0]) =>
      completeA2ATask(principal.clientId, task.id, {
        message: "done",
        artifacts: [],
      }));
    const result = await executeA2ACommand(principal(), sendCommand(), registry({ run }));

    expect(run).toHaveBeenCalled();
    expect(result).toMatchObject({
      jsonrpc: "2.0",
      id: "rpc-1",
      result: {
        kind: "task",
        status: { state: "completed" },
        metadata: { capabilityId: "chief_advisor_conversation" },
      },
    });
  });

  it("rejects capabilities outside the client scope", async () => {
    await expect(executeA2ACommand(
      { ...principal(), capabilities: ["tasks_read"] },
      sendCommand(),
      registry(),
    )).rejects.toMatchObject({ code: "CAPABILITY_NOT_ALLOWED", status: 403 });
  });

  it("refreshes domain-backed tasks before returning GetTask", async () => {
    const run = vi.fn(async ({ principal, task }: Parameters<CapabilityAdapter["run"]>[0]) =>
      completeA2ATask(principal.clientId, task.id, {
        message: "done",
        artifacts: [],
      }));
    const sent = await executeA2ACommand(principal(), sendCommand(), registry({ run })) as {
      result: { id: string };
    };

    const result = await executeA2ACommand(
      principal(),
      { kind: "get-task", requestId: "rpc-2", taskId: sent.result.id },
      registry(),
    );

    expect(result).toMatchObject({
      jsonrpc: "2.0",
      id: "rpc-2",
      result: { id: sent.result.id, status: { state: "completed" } },
    });
  });

  it("marks adapter failures terminal so idempotent replay cannot remain stuck", async () => {
    const failing = {
      run: vi.fn().mockRejectedValue(
        new A2APublicError("INVALID_OPERATION", 422, "Unsupported operation"),
      ),
    };

    await expect(executeA2ACommand(
      principal(),
      sendCommand(),
      registry(failing),
    )).rejects.toMatchObject({ code: "INVALID_OPERATION", status: 422 });

    expect(listA2ATasks("client-1", { limit: 20 }).items).toEqual([
      expect.objectContaining({
        status: "failed",
        error: expect.objectContaining({ code: "INVALID_OPERATION", status: 422 }),
      }),
    ]);
  });

  it("returns 404 for a context owned by another external client", async () => {
    await expect(executeA2ACommand(
      principal(),
      {
        ...sendCommand(),
        payload: { ...sendCommand().payload, contextId: "foreign-context" },
      },
      registry(),
    )).rejects.toMatchObject({ code: "CONTEXT_NOT_FOUND", status: 404 });
  });
});

function principal(): ExternalClientPrincipal {
  return {
    clientId: "client-1",
    name: "Client",
    capabilities: ["chief_advisor_conversation", "tasks_read", "tasks_cancel"],
    rateLimitPerMinute: 60,
  };
}

function sendCommand() {
  return {
    kind: "send-message" as const,
    requestId: "rpc-1",
    payload: {
      messageId: "message-1",
      contextId: null,
      text: "Review my portfolio",
      capabilityId: "chief_advisor_conversation" as const,
      operation: "send",
      input: {},
      acceptedOutputModes: [],
    },
  };
}

function registry(
  advisor: CapabilityAdapter = { run: vi.fn() },
): Record<CapabilityId, CapabilityAdapter> {
  const unsupported = { run: vi.fn() };
  return {
    chief_advisor_conversation: advisor,
    debate_mode: unsupported,
    scenario_simulation: unsupported,
    research_search: unsupported,
  };
}
