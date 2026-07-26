import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { seedAuthenticatedUser, TEST_USER_ID } from "@tests/helpers/auth";
import { getDatabase, isoNow } from "@/server/http/context";

import { getSseEvents, persistSseEvent, SSE_EVENT_TYPES } from "./event-persister";

let dbPath = "";

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
});

describe("SSE_EVENT_TYPES", () => {
  it("has the expected values", () => {
    expect(SSE_EVENT_TYPES).toEqual([
      "run.started",
      "run.completed",
      "run.failed",
      "query.planned",
      "query.validated",
      "query.completed",
      "artifact.completed",
      "branch.options.created",
      "branch.options.failed",
      "branch.created",
      "search.source.completed",
      "portfolio.refreshed",
      "rss.synced",
      "rss.linked",
      "agent.started",
      "agent.delegated",
      "agent.completed",
      "agent.failed",
      "tool.started",
      "tool.completed",
      "tool.failed",
      "evidence.added",
      "advisor.thinking",
      "assistant.delta",
      "compliance.completed",
      "recommendation.created",
      "debate.started",
      "debate.round.started",
      "debate.evidence.started",
      "debate.evidence.completed",
      "debate.agent.started",
      "debate.agent.completed",
      "debate.speech.delta",
      "debate.turn.completed",
      "debate.judge.started",
      "debate.judge.completed",
      "debate.round.completed",
      "debate.blocked",
    ]);
  });

  it("groups child-run events under their persisted root run", () => {
    dbPath = join(tmpdir(), `money-whisperer-sse-root-${randomUUID()}.db`);
    vi.stubEnv("DB_PATH", dbPath);
    seedAuthenticatedUser();
    const db = getDatabase();
    const now = isoNow();
    db.prepare(`INSERT INTO conversation_sessions
      (id,user_id,title,status,created_at,updated_at,row_version)
      VALUES ('conversation_sse',?,'SSE','active',?,?,1)`).run(TEST_USER_ID, now, now);
    db.prepare(`INSERT INTO agent_runs
      (id,user_id,type,status,session_id,root_run_id,created_at)
      VALUES ('analysis_root',?,'debate_agent','running','conversation_sse',NULL,?),
             ('analysis_child',?,'advisor_publication','running','conversation_sse','analysis_root',?)`)
      .run(TEST_USER_ID, now, TEST_USER_ID, now);
    db.close();

    persistSseEvent({
      analysisId: "analysis_child",
      type: "advisor.thinking",
      payload: { publicationGate: true },
    });

    expect(getSseEvents("analysis_root")).toEqual([
      expect.objectContaining({
        analysisId: "analysis_child",
        type: "advisor.thinking",
        payload: { publicationGate: true },
      }),
    ]);
  });
});
