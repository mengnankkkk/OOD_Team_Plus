import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticatedRequest, seedAuthenticatedUser, TEST_USER_ID } from "@tests/helpers/auth";
import { getDatabase } from "@/server/http/context";

import { POST } from "./route";

vi.mock("@/server/extensions/debate/service", () => ({
  startDebate: vi.fn(async () => ({
    debateSessionId: "debate_mock",
    roundId: "debate_round_mock",
    roundIndex: 1,
    analysis: {
      analysisId: "analysis_mock",
      type: "DEBATE",
      status: "COMPLETED",
      streamUrl: "/api/v1/debates/debate_mock/events",
    },
    judgement: {
      userClaim: "用户询问是否加仓。",
      bullStrongestPoint: "多方提出估值修复。",
      bearStrongestPoint: "空方提出趋势风险。",
      keyDisagreement: "估值是否足够便宜。",
      responseQuality: { bull: "direct", bear: "direct" },
      evidenceTilt: "balanced",
      confidence: 0.55,
      whyNotFinal: "缺少更多证据。",
      suggestedNextPrompts: ["让多方解释估值是否真的便宜"],
      complianceNote: "仅用于研究和模拟。",
    },
  })),
}));

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-debate-route-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
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
    expect(body.data.analysis.streamUrl).toBe("/api/v1/debates/debate_mock/events");
  });
});
