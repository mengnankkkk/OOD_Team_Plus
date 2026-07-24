import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as createQuery } from "../../route";
import { GET } from "./route";
import { getDatabase } from "@/server/http/context";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-expired-query-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* SQLite can release Windows handles after test teardown. */ }
  }
});

describe("GET /api/v1/data-queries/:id/result", () => {
  it("returns 410 when a persisted result has expired", async () => {
    const created = await createQuery(new NextRequest("http://localhost/api/v1/data-queries", {
      method: "POST",
      body: JSON.stringify({ questionText: "查询持仓", requestedDatasets: ["PORTFOLIO_HOLDINGS"], outputMode: "SQL_ONLY" }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "expired-query" },
    }));
    const createdBody = await created.json();
    const queryId = createdBody.data.resourceId as string;
    const db = getDatabase();
    db.prepare("UPDATE data_queries SET result_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(queryId);
    db.close();

    const response = await GET(
      new NextRequest(`http://localhost/api/v1/data-queries/${queryId}/result`),
      { params: Promise.resolve({ id: queryId }) },
    );
    const body = await response.json();
    expect(response.status).toBe(410);
    expect(body.error.code).toBe("QUERY_RESULT_EXPIRED");
  });
});
