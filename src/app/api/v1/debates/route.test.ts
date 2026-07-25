import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticatedRequest, seedAuthenticatedUser, TEST_USER_ID } from "@tests/helpers/auth";
import { startDebateInBackground } from "@/server/extensions/debate/service";
import { beginIdempotentRequest } from "@/server/extensions/middleware/idempotency";
import { getDatabase } from "@/server/http/context";

import { POST } from "./route";

vi.mock("@/server/extensions/debate/service", () => ({
  startDebateInBackground: vi.fn(() => ({
    debateSessionId: "debate_mock",
    roundId: "debate_round_mock",
    roundIndex: 1,
    analysis: {
      analysisId: "analysis_mock",
      type: "DEBATE",
      status: "RUNNING",
      streamUrl: "/api/v1/debates/debate_mock/events",
    },
  })),
}));

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-debate-route-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
  vi.clearAllMocks();
  seedAuthenticatedUser();
  const db = getDatabase();
  db.prepare(`INSERT INTO conversation_sessions
    (id,user_id,title,status,created_at,updated_at,row_version)
    VALUES ('conversation_debate',?,'Battle','active','2026-07-25T00:00:00.000Z','2026-07-25T00:00:00.000Z',1)`).run(TEST_USER_ID);
  db.close();
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
});

describe("POST /api/v1/debates", () => {
  it("requires an idempotency key", async () => {
    const res = await POST(authenticatedRequest("http://localhost/api/v1/debates", {
      method: "POST",
      body: JSON.stringify({ conversationId: "conversation_debate", message: "是否加仓 510300？" }),
    }));

    expect(res.status).toBe(400);
  });

  it("starts a debate", async () => {
    const res = await POST(authenticatedRequest("http://localhost/api/v1/debates", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "debate-create-1" },
      body: JSON.stringify({
        conversationId: "conversation_debate",
        message: "是否加仓 510300？",
        targetSymbol: "510300.OF",
        initialUserRole: "neutral",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.data.debateSessionId).toBe("debate_mock");
    expect(body.data.analysis.status).toBe("RUNNING");
    expect(body.data.analysis.streamUrl).toBe("/api/v1/debates/debate_mock/events");
  });

  it("returns RUN_ALREADY_ACTIVE while the same request is in progress", async () => {
    const requestBody = {
      conversationId: "conversation_debate",
      message: "是否加仓 510300？",
      targetSymbol: "510300.OF",
      initialUserRole: "neutral" as const,
    };
    await beginIdempotentRequest(TEST_USER_ID, "debate_create", "debate-create-active", requestBody, { reserve: true });

    const res = await POST(authenticatedRequest("http://localhost/api/v1/debates", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "debate-create-active" },
      body: JSON.stringify(requestBody),
    }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("RUN_ALREADY_ACTIVE");
    expect(startDebateInBackground).not.toHaveBeenCalled();
  });

  it("releases the reservation when debate startup fails synchronously", async () => {
    vi.mocked(startDebateInBackground).mockImplementationOnce(() => {
      throw new Error("synchronous startup failure");
    });
    const request = () => authenticatedRequest("http://localhost/api/v1/debates", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "debate-create-retry" },
      body: JSON.stringify({
        conversationId: "conversation_debate",
        message: "是否加仓 510300？",
        targetSymbol: "510300.OF",
        initialUserRole: "neutral",
      }),
    });

    const failed = await POST(request());
    const retried = await POST(request());

    expect(failed.status).toBe(502);
    expect(retried.status).toBe(202);
    expect(startDebateInBackground).toHaveBeenCalledTimes(2);
  });
});
