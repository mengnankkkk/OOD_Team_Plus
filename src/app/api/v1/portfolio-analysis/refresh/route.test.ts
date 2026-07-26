import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callPandaData } = vi.hoisted(() => ({ callPandaData: vi.fn() }));

vi.mock("@/server/extensions/pandadata/adapter", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/extensions/pandadata/adapter")>(),
  callPandaData,
}));

import { TEST_PORTFOLIO_ID, TEST_USER_ID, authenticatedRequest } from "@tests/helpers/auth";
import { getDatabase } from "@/server/http/context";
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
    const req = authenticatedRequest(url, {
      method: "POST",
      body: JSON.stringify({ portfolioId: TEST_PORTFOLIO_ID }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error.code).toBe("INVALID_REQUEST");
  });

  it("returns 400 when portfolioId is missing", async () => {
    const req = authenticatedRequest(url, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "key1" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 202 with analysis for a valid request", async () => {
    const req = authenticatedRequest(url, {
      method: "POST",
      body: JSON.stringify({ portfolioId: TEST_PORTFOLIO_ID }),
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

  it("keeps portfolio refresh successful when SSE event persistence fails", async () => {
    const db = getDatabase();
    db.exec(`CREATE TRIGGER reject_portfolio_sse_events
      BEFORE INSERT ON agent_run_events BEGIN
        SELECT RAISE(ABORT, 'forced SSE event failure');
      END`);
    db.close();

    for (const idempotencyKey of ["sse-failure-first", "sse-failure-second"]) {
      const response = await POST(authenticatedRequest(url, {
        method: "POST",
        body: JSON.stringify({ portfolioId: TEST_PORTFOLIO_ID }),
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      }));
      expect(response.status).toBe(202);
      expect((await response.json()).data.analysis.status).toBe("COMPLETED");
    }

    const verifyDb = getDatabase();
    const runs = verifyDb.prepare(`SELECT status FROM agent_runs
      WHERE user_id=? AND type='portfolio_refresh' ORDER BY created_at`)
      .all(TEST_USER_ID) as Array<{ status: string }>;
    verifyDb.close();
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.status === "completed")).toBe(true);
  });

  it("uses the A-share realtime daily source for the latest stock price", async () => {
    const db = getDatabase();
    db.prepare("INSERT INTO instruments (id,symbol,name,market,asset_type,sector,tradable) VALUES (?,?,?,?,?,?,1)")
      .run("000001.SZ", "000001.SZ", "平安银行", "SZ", "stock", "银行");
    db.prepare("INSERT INTO holdings (id,user_id,portfolio_id,instrument_id,quantity_decimal,cost_decimal,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,'active',1,?,?)")
      .run("holding-pingan-rt", TEST_USER_ID, TEST_PORTFOLIO_ID, "000001.SZ", "100", "10.00", "2026-07-25T01:00:00.000Z", "2026-07-25T01:00:00.000Z");
    db.close();
    callPandaData.mockImplementation(async (method: string) => ({
      method,
      callDurationMs: 1,
      data: method === "get_stock_rt_daily"
        ? [{ symbol: "000001.SZ", date: "20260725", close: 12.34 }]
        : [
            { symbol: "AAPL", date: "2026-07-24", close: 155 },
            { symbol: "MSFT", date: "2026-07-24", close: 225 },
            { symbol: "SPY", date: "2026-07-24", close: 285 },
          ],
    }));

    const response = await POST(authenticatedRequest(url, {
      method: "POST",
      body: JSON.stringify({ portfolioId: TEST_PORTFOLIO_ID }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "a-share-realtime-price" },
    }));

    expect(response.status).toBe(202);
    expect(callPandaData).toHaveBeenCalledWith(
      "get_stock_rt_daily",
      expect.objectContaining({ symbol: ["000001.SZ"], fields: ["symbol", "date", "close"] }),
    );
    const checkDb = getDatabase();
    const latestPrice = checkDb.prepare(`
      SELECT hs.price_decimal
      FROM holding_snapshots hs
      JOIN portfolio_snapshots ps ON ps.id = hs.portfolio_snapshot_id
      WHERE ps.user_id=? AND hs.instrument_id='000001.SZ'
      ORDER BY ps.created_at DESC, hs.created_at DESC
      LIMIT 1
    `).get(TEST_USER_ID) as { price_decimal: string };
    checkDb.close();
    expect(latestPrice.price_decimal).toBe("12.34");
  });

  it("falls back to the latest historical close when A-share realtime data is empty", async () => {
    const db = getDatabase();
    db.prepare("INSERT INTO instruments (id,symbol,name,market,asset_type,sector,tradable) VALUES (?,?,?,?,?,?,1)")
      .run("000001.SZ", "000001.SZ", "平安银行", "SZ", "stock", "银行");
    db.prepare("INSERT INTO holdings (id,user_id,portfolio_id,instrument_id,quantity_decimal,cost_decimal,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,'active',1,?,?)")
      .run("holding-pingan-weekend", TEST_USER_ID, TEST_PORTFOLIO_ID, "000001.SZ", "100", "10.00", "2026-07-25T01:00:00.000Z", "2026-07-25T01:00:00.000Z");
    db.close();
    callPandaData.mockImplementation(async (method: string) => ({
      method,
      callDurationMs: 1,
      data: method === "get_stock_rt_daily"
        ? []
        : method === "get_stock_daily"
          ? [{ symbol: "000001.SZ", date: "20260724", close: 11.1 }]
          : [
              { symbol: "AAPL", date: "2026-07-24", close: 155 },
              { symbol: "MSFT", date: "2026-07-24", close: 225 },
            ],
    }));

    const response = await POST(authenticatedRequest(url, {
      method: "POST",
      body: JSON.stringify({ portfolioId: TEST_PORTFOLIO_ID }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "a-share-weekend-fallback" },
    }));

    expect(response.status).toBe(202);
    expect(callPandaData).toHaveBeenCalledWith(
      "get_stock_daily",
      expect.objectContaining({
        symbol: ["000001.SZ"],
        fields: ["symbol", "date", "close"],
      }),
    );
    const checkDb = getDatabase();
    const latestPrice = checkDb.prepare(`
      SELECT hs.price_decimal
      FROM holding_snapshots hs
      JOIN portfolio_snapshots ps ON ps.id = hs.portfolio_snapshot_id
      WHERE ps.user_id=? AND hs.instrument_id='000001.SZ'
      ORDER BY ps.created_at DESC, hs.created_at DESC
      LIMIT 1
    `).get(TEST_USER_ID) as { price_decimal: string };
    checkDb.close();
    expect(latestPrice.price_decimal).toBe("11.1");
  });

  it("uses the fund daily source for a tradable ETF cataloged as an index", async () => {
    const db = getDatabase();
    db.prepare("INSERT INTO instruments (id,symbol,name,market,asset_type,sector,tradable) VALUES (?,?,?,?,?,?,1)")
      .run("510050.SH", "510050.SH", "上证50ETF", "SH", "index", "宽基指数");
    db.prepare("INSERT INTO holdings (id,user_id,portfolio_id,instrument_id,quantity_decimal,cost_decimal,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,'active',1,?,?)")
      .run("holding-50-etf", TEST_USER_ID, TEST_PORTFOLIO_ID, "510050.SH", "1000", "2.50", "2026-07-25T01:00:00.000Z", "2026-07-25T01:00:00.000Z");
    db.close();
    callPandaData.mockImplementation(async (method: string) => ({
      method,
      callDurationMs: 1,
      data: method === "get_fund_daily"
        ? [{ symbol: "510050.SH", date: "20260724", close: 2.807 }]
        : [
            { symbol: "AAPL", date: "2026-07-24", close: 155 },
            { symbol: "MSFT", date: "2026-07-24", close: 225 },
            { symbol: "SPY", date: "2026-07-24", close: 285 },
          ],
    }));

    const response = await POST(authenticatedRequest(url, {
      method: "POST",
      body: JSON.stringify({ portfolioId: TEST_PORTFOLIO_ID }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "a-share-etf-price" },
    }));

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.data.dataQuality).toBe("COMPLETE");
    expect(body.data.sourceStatuses).toContainEqual(expect.objectContaining({
      source: "PANDADATA:get_fund_daily",
      status: "SUCCEEDED",
      symbols: ["510050.SH"],
    }));
    expect(body.data.sourceStatuses).not.toContainEqual(expect.objectContaining({
      source: "PREVIOUS_SNAPSHOT",
      symbols: expect.arrayContaining(["510050.SH"]),
    }));
    expect(callPandaData).toHaveBeenCalledWith(
      "get_fund_daily",
      expect.objectContaining({
        symbol: ["510050.SH"],
        fields: ["symbol", "date", "close"],
      }),
    );
    const checkDb = getDatabase();
    const latestPrice = checkDb.prepare(`
      SELECT hs.price_decimal
      FROM holding_snapshots hs
      JOIN portfolio_snapshots ps ON ps.id = hs.portfolio_snapshot_id
      WHERE ps.user_id=? AND hs.instrument_id='510050.SH'
      ORDER BY ps.created_at DESC, hs.created_at DESC
      LIMIT 1
    `).get(TEST_USER_ID) as { price_decimal: string };
    checkDb.close();
    expect(latestPrice.price_decimal).toBe("2.807");
  });
});
