import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prepareDatabase } from "@/server/db/migration-runner";
import {
  cancelA2ATask,
  completeA2ATask,
  createA2ATask,
  getA2ATask,
  listA2ATasks,
  setA2ATaskDomainResource,
  startA2ATask,
} from "./task-service";
import { refreshA2ATaskFromDomain } from "./task-refresh";

describe("A2A task service", () => {
  let dbPath = "";

  beforeEach(() => {
    dbPath = `/tmp/a2a-task-${crypto.randomUUID()}.db`;
    vi.stubEnv("DB_PATH", dbPath);
    seedDatabase(dbPath);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("replays the same client message and rejects changed content", () => {
    const input = {
      externalClientId: "client-1",
      contextId: "context-1",
      capabilityId: "debate_mode" as const,
      operation: "start",
      clientMessageId: "message-1",
      input: { text: "AAPL debate" },
    };

    const first = createA2ATask(input);
    const replay = createA2ATask(input);

    expect(replay).toMatchObject({ replayed: true, task: { id: first.task.id } });
    expect(() => createA2ATask({
      ...input,
      input: { text: "Different request" },
    })).toThrowError("IDEMPOTENCY_CONFLICT");
  });

  it("isolates task reads and listings by external client", () => {
    const created = createA2ATask({
      externalClientId: "client-1",
      contextId: "context-1",
      capabilityId: "research_search",
      operation: "start",
      clientMessageId: "message-1",
      input: { query: "AAPL" },
    });

    expect(getA2ATask("client-2", created.task.id)).toBeNull();
    expect(listA2ATasks("client-1", { limit: 20 }).items).toHaveLength(1);
    expect(listA2ATasks("client-2", { limit: 20 }).items).toHaveLength(0);
  });

  it("does not let a late completion overwrite cancellation", () => {
    const created = createA2ATask({
      externalClientId: "client-1",
      contextId: "context-1",
      capabilityId: "research_search",
      operation: "start",
      clientMessageId: "message-late",
      input: { query: "AAPL" },
    });
    startA2ATask("client-1", created.task.id);
    cancelA2ATask("client-1", created.task.id);

    const late = completeA2ATask("client-1", created.task.id, {
      message: "late",
      artifacts: [],
    });

    expect(late.status).toBe("canceled");
    expect(late.result).toBeNull();
    expect(late.events.map((event) => event.eventType)).not.toContain("task.completed");
  });

  it("refreshes a working research task from its persisted domain result", () => {
    const created = createA2ATask({
      externalClientId: "client-1",
      contextId: "context-1",
      capabilityId: "research_search",
      operation: "start",
      clientMessageId: "message-refresh",
      input: { query: "AAPL" },
    });
    startA2ATask("client-1", created.task.id);
    setA2ATaskDomainResource("client-1", created.task.id, "research_search", "search-1");
    const db = new Database(dbPath);
    db.prepare(`INSERT INTO research_searches
      (id,user_id,query_text,adapters_json,status,created_at,completed_at)
      VALUES ('search-1','exec-1','AAPL','["WEB"]','succeeded',?,?)`).run(
      "2026-07-25T00:00:00.000Z",
      "2026-07-25T00:00:01.000Z",
    );
    db.prepare(`INSERT INTO research_results
      (id,search_id,adapter,title,url,snippet,citation,created_at)
      VALUES ('result-1','search-1','web','Apple filing','https://example.com/apple','Risk factors','https://example.com/apple',?)`)
      .run("2026-07-25T00:00:01.000Z");
    db.close();

    const refreshed = refreshA2ATaskFromDomain("client-1", created.task.id);

    expect(refreshed).toMatchObject({
      status: "completed",
      result: {
        artifacts: [{
          name: "research_results",
          data: {
            items: [{
              title: "Apple filing",
              citation: "https://example.com/apple",
            }],
          },
        }],
      },
    });
  });
});

function seedDatabase(path: string): void {
  const db = new Database(path);
  prepareDatabase(db as never, path);
  const now = "2026-07-25T00:00:00.000Z";
  db.prepare("INSERT INTO users (id,display_name,created_at) VALUES ('admin','Admin',?)").run(now);
  db.prepare("INSERT INTO users (id,display_name,created_at) VALUES ('exec-1','External',?)").run(now);
  db.prepare(`INSERT INTO a2a_external_clients
    (id,name,status,capabilities_json,rate_limit_per_minute,created_by_user_id,created_at,updated_at,row_version)
    VALUES ('client-1','Client 1','ACTIVE','[]',60,'admin',?,?,1)`).run(now, now);
  db.prepare(`INSERT INTO a2a_external_clients
    (id,name,status,capabilities_json,rate_limit_per_minute,created_by_user_id,created_at,updated_at,row_version)
    VALUES ('client-2','Client 2','ACTIVE','[]',60,'admin',?,?,1)`).run(now, now);
  db.prepare(`INSERT INTO a2a_contexts
    (id,external_client_id,execution_user_id,primary_capability,created_at,updated_at,expires_at)
    VALUES ('context-1','client-1','exec-1','research_search',?,?,?)`).run(
    now,
    now,
    "2026-08-24T00:00:00.000Z",
  );
  db.close();
}
