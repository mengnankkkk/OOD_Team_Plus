import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { prepareDatabase } from "./migration-runner";

describe("main branch migration contracts", () => {
  it("creates the debate tables and enforces conversation ownership", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    prepareDatabase(db as never, ":memory:");

    expect(db.prepare(`SELECT name FROM sqlite_master
      WHERE type='table'
        AND name IN (
          'debate_sessions','debate_rounds','debate_turns',
          'debate_arguments','debate_judgements'
        )
      ORDER BY name`).all()).toEqual([
      { name: "debate_arguments" },
      { name: "debate_judgements" },
      { name: "debate_rounds" },
      { name: "debate_sessions" },
      { name: "debate_turns" },
    ]);
    db.prepare(`INSERT INTO agent_runs
      (id,user_id,type,status,created_at)
      VALUES ('debate-run','test-user','debate_agent','running',
        '2026-07-25T00:00:00.000Z')`).run();
    expect(() => db.prepare(`INSERT INTO debate_sessions
      (id,user_id,conversation_id,root_agent_run_id,motion,created_at,updated_at)
      VALUES ('debate-session','test-user','missing-conversation','debate-run',
        'Motion','2026-07-25T00:00:00.000Z','2026-07-25T00:00:00.000Z')`).run())
      .toThrow(/FOREIGN KEY constraint failed/u);
    db.close();
  });

  it("creates the external A2A gateway tables", () => {
    const db = new Database(":memory:");
    prepareDatabase(db as never, ":memory:");

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
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table)).toEqual({ name: table });
    }
    db.close();
  });
});
