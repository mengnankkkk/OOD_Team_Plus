import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { backupDatabase, prepareDatabase } from "./migration-runner";

describe("database migration guard", () => {
  it("executes and records every migration", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    prepareDatabase(db as never, ":memory:");
    expect(db.pragma("user_version", { simple: true })).toBe(16);
    expect((db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count).toBe(19);
    expect(db.prepare(`SELECT name FROM sqlite_master
      WHERE type='table' AND name IN ('debate_sessions','debate_rounds','debate_turns','debate_arguments','debate_judgements')
      ORDER BY name`).all()).toEqual([
      { name: "debate_arguments" },
      { name: "debate_judgements" },
      { name: "debate_rounds" },
      { name: "debate_sessions" },
      { name: "debate_turns" },
    ]);
    db.prepare("INSERT INTO agent_runs (id,user_id,type,status,created_at) VALUES ('debate-run','test-user','debate_agent','running','2026-07-25T00:00:00.000Z')").run();
    expect(() => db.prepare(`INSERT INTO debate_sessions
      (id,user_id,conversation_id,root_agent_run_id,motion,created_at,updated_at)
      VALUES ('debate-session','test-user','missing-conversation','debate-run','Motion','2026-07-25T00:00:00.000Z','2026-07-25T00:00:00.000Z')`).run())
      .toThrow(/FOREIGN KEY constraint failed/u);
    expect(() => prepareDatabase(db as never, ":memory:")).not.toThrow();
    db.close();
  });

  it("creates the external A2A gateway tables", () => {
    const db = new Database(":memory:");
    prepareDatabase(db as never, ":memory:");

    expect(db.pragma("user_version", { simple: true })).toBe(16);
    expect((db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count).toBe(19);

    for (const table of [
      "a2a_external_clients",
      "a2a_external_client_tokens",
      "a2a_contexts",
      "a2a_tasks",
      "a2a_task_events",
      "a2a_debate_sessions",
      "a2a_debate_rounds",
      "a2a_debate_turns",
    ]) {
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)).toEqual({ name: table });
    }

    db.close();
  });

  it("does not create backups for in-memory databases", () => {
    expect(backupDatabase(":memory:")).toBe(":memory:");
  });

  it("creates a consistent online backup that can restore stored values", () => {
    const directory = mkdtempSync(join(tmpdir(), "money-whisperer-backup-"));
    const sourcePath = join(directory, "source.db");
    const source = new Database(sourcePath);
    source.pragma("journal_mode = WAL");
    source.exec("CREATE TABLE ledger (id TEXT PRIMARY KEY, amount_decimal TEXT NOT NULL); INSERT INTO ledger VALUES ('asset-1','1234567890.123456789');");
    const target = backupDatabase(sourcePath, source as never);
    source.close();

    const restored = new Database(target, { readonly: true });
    const row = restored.prepare("SELECT amount_decimal FROM ledger WHERE id='asset-1'").get() as { amount_decimal: string };
    restored.close();
    expect(row.amount_decimal).toBe("1234567890.123456789");
    rmSync(directory, { recursive: true, force: true });
  });
});
