import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticatedRequest, seedAuthenticatedUser, TEST_USER_ID } from "@tests/helpers/auth";
import { continueDebateInBackground } from "@/server/extensions/debate/service";
import { beginIdempotentRequest } from "@/server/extensions/middleware/idempotency";

import { POST } from "./route";

vi.mock("@/server/extensions/debate/service", () => ({
  continueDebateInBackground: vi.fn(() => ({
    debateSessionId: "debate_active",
    roundIndex: 2,
    analysis: {
      analysisId: "analysis_mock",
      type: "DEBATE",
      status: "RUNNING",
      streamUrl: "/api/v1/debates/debate_active/events",
    },
  })),
}));

const debateId = "debate_active";
let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-debate-turn-route-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
  vi.clearAllMocks();
  seedAuthenticatedUser();
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
});

describe("POST /api/v1/debates/:id/turns", () => {
  it("returns RUN_ALREADY_ACTIVE while the same request is in progress", async () => {
    const requestBody = { content: "我站多方，请继续。", userRole: "bull" as const };
    await beginIdempotentRequest(TEST_USER_ID, `debate_turn:${debateId}`, "debate-turn-active", requestBody, { reserve: true });

    const res = await POST(authenticatedRequest(`http://localhost/api/v1/debates/${debateId}/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "debate-turn-active" },
      body: JSON.stringify(requestBody),
    }), { params: Promise.resolve({ id: debateId }) });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("RUN_ALREADY_ACTIVE");
    expect(continueDebateInBackground).not.toHaveBeenCalled();
  });

  it("releases the reservation when turn startup fails synchronously", async () => {
    vi.mocked(continueDebateInBackground).mockImplementationOnce(() => {
      throw new Error("synchronous turn startup failure");
    });
    const request = () => authenticatedRequest(`http://localhost/api/v1/debates/${debateId}/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "debate-turn-retry" },
      body: JSON.stringify({ content: "我站多方，请继续。", userRole: "bull" }),
    });
    const context = () => ({ params: Promise.resolve({ id: debateId }) });

    const failed = await POST(request(), context());
    const retried = await POST(request(), context());

    expect(failed.status).toBe(502);
    expect(retried.status).toBe(202);
    expect(continueDebateInBackground).toHaveBeenCalledTimes(2);
  });
});
