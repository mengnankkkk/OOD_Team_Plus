import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as createQuery } from "../../../data-queries/route";
import { POST } from "./route";
import { getDatabase } from "@/server/http/context";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-analysis-retry-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* SQLite can release Windows handles after test teardown. */ }
  }
});

describe("POST /api/v1/analyses/:id/retry", () => {
  it("re-executes a failed data query instead of leaving it queued", async () => {
    const created = await createQuery(new NextRequest("http://localhost/api/v1/data-queries", {
      method: "POST",
      body: JSON.stringify({ questionText: "查询持仓", requestedDatasets: ["PORTFOLIO_HOLDINGS"], outputMode: "SQL_ONLY" }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "retry-source-query" },
    }));
    const createdBody = await created.json();
    const sourceAnalysisId = createdBody.data.analysis.analysisId as string;
    const db = getDatabase();
    db.prepare("UPDATE agent_runs SET status='failed',failure_code='TEST_FAILURE',failure_message='retry test' WHERE id=?").run(sourceAnalysisId);
    db.close();

    const retried = await POST(
      new NextRequest(`http://localhost/api/v1/analyses/${sourceAnalysisId}/retry`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json", "Idempotency-Key": "retry-query" } }),
      { params: Promise.resolve({ id: sourceAnalysisId }) },
    );
    const retriedBody = await retried.json();
    expect(retried.status).toBe(202);
    expect(retriedBody.data.status).toBe("COMPLETED");
    expect(retriedBody.data.analysisId).not.toBe(sourceAnalysisId);
    expect(retriedBody.data.result.rowCount).toBeGreaterThan(0);
  });

  it("returns a domain conflict for an unsupported legacy run", async () => {
    const db = getDatabase();
    db.prepare("INSERT INTO agent_runs (id,user_id,type,status,created_at) VALUES ('legacy-failure','demo-user','legacy_task','failed','2026-07-24T00:00:00.000Z')").run();
    db.close();
    const response = await POST(
      new NextRequest("http://localhost/api/v1/analyses/legacy-failure/retry", { method: "POST", body: "{}", headers: { "Content-Type": "application/json", "Idempotency-Key": "retry-legacy" } }),
      { params: Promise.resolve({ id: "legacy-failure" }) },
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("ANALYSIS_RETRY_UNSUPPORTED");
  });
});
