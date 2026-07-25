import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticatedRequest, seedAuthenticatedUser, TEST_USER_ID } from "@tests/helpers/auth";
import { persistSseEvent } from "@/server/extensions/sse/event-persister";
import { getDatabase, isoNow } from "@/server/http/context";
import { GET } from "./route";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-debate-events-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
  seedAuthenticatedUser();
  const db = getDatabase();
  const now = isoNow();
  db.prepare("INSERT INTO conversation_sessions (id,user_id,title,status,created_at,updated_at,row_version) VALUES ('conversation_events',?,'Battle','active',?,?,1)")
    .run(TEST_USER_ID, now, now);
  db.prepare("INSERT INTO agent_runs (id,user_id,type,status,session_id,created_at,completed_at) VALUES ('analysis_events',?,'debate_agent','completed','conversation_events',?,?)")
    .run(TEST_USER_ID, now, now);
  db.prepare(`INSERT INTO debate_sessions
    (id,user_id,conversation_id,root_agent_run_id,motion,user_debate_role,status,current_round_index,created_at,updated_at)
    VALUES ('debate_events',?,'conversation_events','analysis_events','是否加仓','neutral','active',1,?,?)`)
    .run(TEST_USER_ID, now, now);
  db.close();
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
});

describe("GET /api/v1/debates/:id/events", () => {
  it("starts after the cursor supplied in the stream URL", async () => {
    persistSseEvent({ analysisId: "analysis_events", type: "debate.round.completed", payload: { roundIndex: 1 } });
    persistSseEvent({ analysisId: "analysis_events", type: "debate.agent.completed", payload: { roundIndex: 2, speaker: "bull" } });
    const db = getDatabase();
    const ids = db.prepare("SELECT id FROM agent_run_events WHERE root_run_id='analysis_events' ORDER BY sequence_no").all() as Array<{ id: string }>;
    db.close();

    const response = await GET(
      authenticatedRequest(`http://localhost/api/v1/debates/debate_events/events?after=${ids[0].id}`),
      { params: Promise.resolve({ id: "debate_events" }) },
    );
    const payload = await response.text();

    expect(payload).not.toContain(`id: ${ids[0].id}`);
    expect(payload).toContain(`id: ${ids[1].id}`);
    expect(payload).toContain('"roundIndex":2');
  });
});
