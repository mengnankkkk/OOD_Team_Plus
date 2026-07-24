import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase, isoNow } from "@/server/http/context";
import { persistSseEvent } from "@/server/extensions/sse/event-persister";
import { GET } from "./route";

beforeEach(() => {
  const db = getDatabase();
  db.prepare("DELETE FROM agent_run_events WHERE agent_run_id='analysis_1'").run();
  db.prepare("DELETE FROM agent_runs WHERE id='analysis_1'").run();
  db.prepare("INSERT INTO agent_runs (id,user_id,type,status,created_at,completed_at) VALUES ('analysis_1','demo-user','test','completed',?,?)").run(isoNow(), isoNow());
  db.close();
});

describe("GET /api/v1/analyses/[id]/events", () => {
  it("returns an SSE response", async () => {
    const req = new NextRequest("http://localhost/api/v1/analyses/analysis_1/events", {
      headers: { "Last-Event-ID": "event_1" },
    });

    const res = await GET(req, { params: Promise.resolve({ id: "analysis_1" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });

  it("resumes strictly after Last-Event-ID", async () => {
    persistSseEvent({ analysisId: "analysis_1", type: "agent.started", payload: { order: 1 } });
    persistSseEvent({ analysisId: "analysis_1", type: "agent.completed", payload: { order: 2 } });
    const db = getDatabase();
    const ids = db.prepare("SELECT id FROM agent_run_events WHERE agent_run_id='analysis_1' ORDER BY sequence_no").all() as Array<{ id: string }>;
    db.close();

    const res = await GET(new NextRequest("http://localhost/api/v1/analyses/analysis_1/events", {
      headers: { "Last-Event-ID": ids[0].id },
    }), { params: Promise.resolve({ id: "analysis_1" }) });
    const payload = await res.text();

    expect(payload).not.toContain(`id: ${ids[0].id}`);
    expect(payload).toContain(`id: ${ids[1].id}`);
    expect(payload).toContain('"order":2');
  });
});
