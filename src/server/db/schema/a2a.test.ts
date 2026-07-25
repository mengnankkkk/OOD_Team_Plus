import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { prepareDatabase } from "../migration-runner";

describe("external A2A schema", () => {
  it("enforces task idempotency per client", () => {
    const db = new Database(":memory:");
    prepareDatabase(db as never, ":memory:");
    seedClientContext(db);
    const insert = db.prepare(`INSERT INTO a2a_tasks
      (id,external_client_id,context_id,capability_id,operation,client_message_id,request_hash,status,input_json,created_at,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    insert.run("task-1", "client-1", "context-1", "debate_mode", "start", "message-1", "hash-1", "submitted", "{}", now(), future());
    expect(() => insert.run("task-2", "client-1", "context-1", "debate_mode", "continue", "message-1", "hash-2", "submitted", "{}", now(), future()))
      .toThrow();
    db.close();
  });
});

function seedClientContext(db: Database.Database) {
  const timestamp = now();
  db.prepare("INSERT INTO users (id,display_name,created_at) VALUES ('admin','Admin',?)").run(timestamp);
  db.prepare("INSERT INTO users (id,display_name,created_at) VALUES ('exec-1','External execution',?)").run(timestamp);
  db.prepare(`INSERT INTO a2a_external_clients
    (id,name,status,capabilities_json,rate_limit_per_minute,created_by_user_id,created_at,updated_at,row_version)
    VALUES ('client-1','Client','ACTIVE','["debate_mode"]',60,'admin',?,?,1)`).run(timestamp, timestamp);
  db.prepare(`INSERT INTO a2a_contexts
    (id,external_client_id,execution_user_id,primary_capability,profile_json,goals_json,portfolio_input_json,created_at,updated_at,expires_at)
    VALUES ('context-1','client-1','exec-1','debate_mode','{}','[]','{}',?,?,?)`).run(timestamp, timestamp, future());
}

function now() {
  return "2026-07-25T00:00:00.000Z";
}

function future() {
  return "2026-08-24T00:00:00.000Z";
}
