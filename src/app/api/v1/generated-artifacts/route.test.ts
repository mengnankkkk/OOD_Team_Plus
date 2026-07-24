import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase, isoNow } from "@/server/http/context";
import { GET, POST } from "./route";

const url = "http://localhost/api/v1/generated-artifacts";

beforeEach(() => {
  const db = getDatabase();
  for (const table of ["message_artifacts", "generated_artifact_versions", "generated_artifacts", "idempotency_records", "messages", "conversation_sessions"]) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  db.close();
});

function createSourceMessage() {
  const db = getDatabase();
  const now = isoNow();
  db.prepare("INSERT INTO conversation_sessions (id,user_id,title,status,created_at,updated_at) VALUES (?,?,?,'active',?,?)")
    .run("conversation-1", "demo-user", "Artifact test", now, now);
  db.prepare("INSERT INTO messages (id,session_id,role,content,created_at) VALUES (?,?,'assistant',?,?)")
    .run("msg1", "conversation-1", "这是可见的持仓分析结论。", now);
  db.close();
}

describe("POST /api/v1/generated-artifacts", () => {
  it("returns 400 without Idempotency-Key", async () => {
    const req = new NextRequest(url, {
      method: "POST",
      body: JSON.stringify({ artifactType: "MARKDOWN", title: "Summary", sourceMessageId: "msg1" }),
    });

    expect((await POST(req)).status).toBe(400);
  });

  it("returns 400 without sourceMessageId or sourceQueryId", async () => {
    const req = new NextRequest(url, {
      method: "POST",
      body: JSON.stringify({ artifactType: "MARKDOWN", title: "Summary" }),
      headers: { "Idempotency-Key": "key1" },
    });

    expect((await POST(req)).status).toBe(400);
  });

  it("returns 202 for valid request with sourceMessageId", async () => {
    createSourceMessage();
    const req = new NextRequest(url, {
      method: "POST",
      body: JSON.stringify({ artifactType: "MARKDOWN", title: "Summary", sourceMessageId: "msg1" }),
      headers: { "Idempotency-Key": "key1" },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.data.analysis.type).toBe("ARTIFACT_GENERATION");
    expect(body.data.analysis.status).toBe("COMPLETED");
    expect(body.data.resourceId).toMatch(/^artifact_/u);
  });
});

describe("GET /api/v1/generated-artifacts", () => {
  it("returns an empty paginated list", async () => {
    const res = await GET(new NextRequest(`${url}?limit=10`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.items).toEqual([]);
    expect(body.meta.pagination).toEqual({ limit: 10, nextCursor: null, hasMore: false });
  });
});
