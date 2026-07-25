import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prepareDatabase } from "@/server/db/migration-runner";
import { cleanupExpiredA2AContexts, deleteA2AContext } from "./cleanup";

describe("A2A context cleanup", () => {
  beforeEach(() => {
    vi.stubEnv("DB_PATH", `/tmp/a2a-cleanup-${crypto.randomUUID()}.db`);
    seed();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("deletes expired external data and preserves real users", () => {
    const result = cleanupExpiredA2AContexts("2026-08-25T00:00:00.000Z");
    const db = new Database(process.env.DB_PATH!);

    expect(db.prepare("SELECT id FROM users WHERE id='real-user'").get()).toEqual({ id: "real-user" });
    expect(db.prepare("SELECT id FROM users WHERE id='exec-expired'").get()).toBeUndefined();
    expect(db.prepare("SELECT id FROM a2a_contexts WHERE id='context-expired'").get()).toBeUndefined();
    db.close();
    expect(result.deletedContexts).toBe(1);
  });

  it("hides foreign contexts during early deletion", () => {
    expect(() => deleteA2AContext("client-2", "context-expired"))
      .toThrowError("Context not found");
  });
});

function seed(): void {
  const db = new Database(process.env.DB_PATH!);
  prepareDatabase(db as never, process.env.DB_PATH!);
  const now = "2026-07-25T00:00:00.000Z";
  db.prepare("INSERT INTO users (id,display_name,created_at) VALUES ('admin','Admin',?)").run(now);
  db.prepare("INSERT INTO users (id,display_name,created_at) VALUES ('real-user','Real',?)").run(now);
  db.prepare("INSERT INTO users (id,display_name,created_at) VALUES ('exec-expired','External',?)").run(now);
  for (const clientId of ["client-1", "client-2"]) {
    db.prepare(`INSERT INTO a2a_external_clients
      (id,name,status,capabilities_json,rate_limit_per_minute,created_by_user_id,created_at,updated_at,row_version)
      VALUES (?,?, 'ACTIVE','[]',60,'admin',?,?,1)`).run(clientId, clientId, now, now);
  }
  db.prepare(`INSERT INTO a2a_contexts
    (id,external_client_id,execution_user_id,primary_capability,created_at,updated_at,expires_at)
    VALUES ('context-expired','client-1','exec-expired','research_search',?,?,?)`).run(
    now,
    now,
    "2026-08-24T00:00:00.000Z",
  );
  db.prepare(`INSERT INTO a2a_tasks
    (id,external_client_id,context_id,capability_id,operation,client_message_id,request_hash,status,input_json,created_at,expires_at)
    VALUES ('task-working','client-1','context-expired','research_search','start','message-1','hash','working','{}',?,?)`).run(
    now,
    "2026-08-24T00:00:00.000Z",
  );
  db.prepare(`INSERT INTO conversation_sessions
    (id,user_id,title,status,created_at,updated_at,row_version)
    VALUES ('external-session','exec-expired','External','active',?,?,1)`).run(now, now);
  db.close();
}
