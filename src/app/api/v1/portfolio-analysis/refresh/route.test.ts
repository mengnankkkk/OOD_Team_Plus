import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callPandaData } = vi.hoisted(() => ({ callPandaData: vi.fn() }));

vi.mock("@/server/extensions/pandadata/adapter", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/extensions/pandadata/adapter")>(),
  callPandaData,
}));

import { POST } from "./route";

const url = "http://localhost/api/v1/portfolio-analysis/refresh";
let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-refresh-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
  callPandaData.mockResolvedValue({
    method: "get_us_daily",
    callDurationMs: 1,
    data: [
      { symbol: "AAPL", date: "2026-07-24", close: 155 },
      { symbol: "MSFT", date: "2026-07-24", close: 225 },
      { symbol: "SPY", date: "2026-07-24", close: 285 },
    ],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* Windows may retain a failed SQLite handle briefly. */ }
  }
});

describe("POST /api/v1/portfolio-analysis/refresh", () => {
  it("returns 400 when Idempotency-Key is missing", async () => {
    const req = new NextRequest(url, {
      method: "POST",
      body: JSON.stringify({ portfolioId: "portfolio-demo" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error.code).toBe("INVALID_REQUEST");
  });

  it("returns 400 when portfolioId is missing", async () => {
    const req = new NextRequest(url, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "key1" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 202 with analysis for a valid request", async () => {
    const req = new NextRequest(url, {
      method: "POST",
      body: JSON.stringify({ portfolioId: "portfolio-demo" }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "key1" },
    });

    const res = await POST(req);
    expect(res.status).toBe(202);

    const data = await res.json();
    expect(data.data.analysis.type).toBe("PORTFOLIO_REFRESH");
    expect(data.data.analysis.status).toBe("COMPLETED");
    expect(data.data.dataQuality).toBe("COMPLETE");
    expect(data.data.portfolioSnapshotId).toMatch(/^portfolio_snapshot_/u);
  });
});
