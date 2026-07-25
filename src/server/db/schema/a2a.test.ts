import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { prepareDatabase } from "../migration-runner";

describe("external A2A schema", () => {
  it("enforces task idempotency per client", () => {
    const db = createTestDatabase();
    seedClientContext(db);
    insertTask(db, "task-1", "client-a", "context-a", "message-1", "hash-1");
    expect(() => insertTask(db, "task-2", "client-a", "context-a", "message-1", "hash-2"))
      .toThrow();
    db.close();
  });

  it("rejects a task whose context belongs to another client", () => {
    const db = createTestDatabase();
    seedClientContext(db);

    insertTask(db, "task-valid", "client-a", "context-a", "message-valid", "hash-valid");
    expect(() => insertTask(db, "task-cross-client", "client-b", "context-a", "message-cross-client", "hash-cross-client"))
      .toThrow(/FOREIGN KEY constraint failed/);

    db.close();
  });

  it("deletes tasks when their context is deleted", () => {
    const db = createTestDatabase();
    seedClientContext(db);
    insertTask(db, "task-1", "client-a", "context-a", "message-1", "hash-1");

    db.prepare("DELETE FROM a2a_contexts WHERE id = ?").run("context-a");

    expect(db.prepare("SELECT id FROM a2a_tasks WHERE id = ?").get("task-1")).toBeUndefined();
    db.close();
  });
});

function createTestDatabase() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  prepareDatabase(db as never, ":memory:");
  return db;
}

function seedClientContext(db: Database.Database) {
  const timestamp = now();
  db.prepare("INSERT INTO users (id,display_name,created_at) VALUES ('admin','Admin',?)").run(timestamp);
  db.prepare("INSERT INTO users (id,display_name,created_at) VALUES ('exec-a','External execution',?)").run(timestamp);
  const insertClient = db.prepare(`INSERT INTO a2a_external_clients
    (id,name,status,capabilities_json,rate_limit_per_minute,created_by_user_id,created_at,updated_at,row_version)
    VALUES (?,?,'ACTIVE','["debate_mode"]',60,'admin',?,?,1)`);
  insertClient.run("client-a", "Client A", timestamp, timestamp);
  insertClient.run("client-b", "Client B", timestamp, timestamp);
  db.prepare(`INSERT INTO a2a_contexts
    (id,external_client_id,execution_user_id,primary_capability,profile_json,goals_json,portfolio_input_json,created_at,updated_at,expires_at)
    VALUES ('context-a','client-a','exec-a','debate_mode','{}','[]','{}',?,?,?)`).run(timestamp, timestamp, future());
}

function insertTask(
  db: Database.Database,
  id: string,
  externalClientId: string,
  contextId: string,
  clientMessageId: string,
  requestHash: string,
) {
  db.prepare(`INSERT INTO a2a_tasks
    (id,external_client_id,context_id,capability_id,operation,client_message_id,request_hash,status,input_json,created_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, externalClientId, contextId, "debate_mode", "start", clientMessageId, requestHash, "submitted", "{}", now(), future());
}

function now() {
  return "2026-07-25T00:00:00.000Z";
}

function future() {
  return "2026-08-24T00:00:00.000Z";
}
