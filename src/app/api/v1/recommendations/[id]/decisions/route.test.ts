import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticatedRequest, seedAuthenticatedUser } from "@tests/helpers/auth";
import { getDatabase } from "@/server/http/context";
import { GET as listDecisions } from "../../../decisions/route";
import { POST } from "./route";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-recommendation-decision-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* SQLite can release handles after teardown. */ }
  }
});

describe("POST /api/v1/recommendations/:id/decisions", () => {
  it("blocks adoption when compliance has blocked the recommendation", async () => {
    const userId = "blocked-decision-user";
    seedAuthenticatedUser({ userId });
    seedRecommendation(userId, "recommendation-blocked", "analysis-blocked", "BLOCKED");

    const response = await POST(
      authenticatedRequest("http://localhost/api/v1/recommendations/recommendation-blocked/decisions", {
        method: "POST",
        body: JSON.stringify({ action: "ACCEPT" }),
        headers: { "Content-Type": "application/json", "Idempotency-Key": "blocked-accept" },
      }, { userId }),
      { params: Promise.resolve({ id: "recommendation-blocked" }) },
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("RECOMMENDATION_BLOCKED");
  });

  it("updates recommendation state and returns a normalized, linkable decision log", async () => {
    const userId = "active-decision-user";
    seedAuthenticatedUser({ userId });
    seedRecommendation(userId, "recommendation-active", "analysis-active", "ACTIVE");

    const accepted = await POST(
      authenticatedRequest("http://localhost/api/v1/recommendations/recommendation-active/decisions", {
        method: "POST",
        body: JSON.stringify({ action: "ACCEPT", reason: "风险预算允许，先做模拟" }),
        headers: { "Content-Type": "application/json", "Idempotency-Key": "active-accept" },
      }, { userId }),
      { params: Promise.resolve({ id: "recommendation-active" }) },
    );

    expect(accepted.status).toBe(201);
    const acceptedBody = await accepted.json();
    expect(acceptedBody.data).toMatchObject({
      recommendationId: "recommendation-active",
      analysisId: "analysis-active",
      action: "SIMULATED",
      recommendationStatus: "SIMULATED",
    });

    const db = getDatabase();
    const row = db.prepare("SELECT status FROM recommendations WHERE id=?").get("recommendation-active") as { status: string };
    db.close();
    expect(row.status).toBe("SIMULATED");

    const listed = await listDecisions(authenticatedRequest("http://localhost/api/v1/decisions", {}, { userId }));
    const listedBody = await listed.json();
    expect(listedBody.data.items[0]).toMatchObject({
      recommendationId: "recommendation-active",
      analysisId: "analysis-active",
      action: "simulated",
      reason: "风险预算允许，先做模拟",
    });

    const revoked = await POST(
      authenticatedRequest("http://localhost/api/v1/recommendations/recommendation-active/decisions", {
        method: "POST",
        body: JSON.stringify({ action: "REVOKE", reason: "暂时恢复观察" }),
        headers: { "Content-Type": "application/json", "Idempotency-Key": "active-revoke" },
      }, { userId }),
      { params: Promise.resolve({ id: "recommendation-active" }) },
    );
    expect(revoked.status).toBe(201);
    expect((await revoked.json()).data).toMatchObject({ action: "REVOKED", recommendationStatus: "ACTIVE" });
  });
});

function seedRecommendation(userId: string, id: string, analysisId: string, status: string) {
  const db = getDatabase();
  db.prepare("INSERT INTO agent_runs (id,user_id,type,status,created_at,completed_at) VALUES (?,?,?,'completed',?,?)")
    .run(analysisId, userId, "conversation_agent", "2026-07-25T08:00:00.000Z", "2026-07-25T08:00:01.000Z");
  db.prepare(`INSERT INTO recommendations
    (id,user_id,analysis_id,action,suitability,summary,position_range_json,add_conditions_json,reasons_json,counter_evidence_json,risks_json,alternatives_json,compliance_json,provenance_json,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, userId, analysisId, "HOLD", "MEDIUM", "维持仓位并观察",
    "[]", "[]", "[\"组合风险可控\"]", "[\"市场可能继续波动\"]", "[]", "[]",
    status === "BLOCKED" ? "{\"status\":\"BLOCKED\"}" : "{\"status\":\"PASSED\"}", "{}", status,
    "2026-07-25T08:00:01.000Z", "2026-07-25T08:00:01.000Z",
  );
  db.close();
}
