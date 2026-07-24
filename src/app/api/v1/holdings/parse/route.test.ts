import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as confirm } from "./[parseId]/confirm/route";
import { POST } from "./route";
import { getDatabase } from "@/server/http/context";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-holding-parse-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* SQLite can release Windows handles after test teardown. */ }
  }
});

describe("holding text parsing", () => {
  it("parses a Chinese index position and synchronizes a confirmed ETF holding", async () => {
    const parsed = await POST(new NextRequest("http://localhost/api/v1/holdings/parse", {
      method: "POST",
      body: JSON.stringify({ text: "我在沪深300指数100点时买了100股", defaultMarket: "CN" }),
      headers: { "Content-Type": "application/json" },
    }));
    const parsedBody = await parsed.json();
    expect(parsed.status).toBe(200);
    expect(parsedBody.data.candidates[0]).toMatchObject({ quantity: "100", averageCost: "100" });
    expect(parsedBody.data.candidates[0].issues[0].code).toBe("DIRECT_INDEX_NOT_TRADABLE");
    expect(parsedBody.data.candidates[0].suggestedMatches.length).toBeGreaterThan(0);

    const parseId = parsedBody.data.parseId as string;
    const confirmed = await confirm(
      new NextRequest(`http://localhost/api/v1/holdings/parse/${parseId}/confirm`, {
        method: "POST",
        body: JSON.stringify({ confirmedCandidates: [{ candidateId: parsedBody.data.candidates[0].candidateId, symbol: "510300.SH", quantity: "100", averageCost: "4.20" }] }),
        headers: { "Content-Type": "application/json", "Idempotency-Key": "confirm-demo300" },
      }),
      { params: Promise.resolve({ parseId }) },
    );
    const confirmedBody = await confirmed.json();
    expect(confirmed.status).toBe(201);
    expect(confirmedBody.data.holdings[0]).toMatchObject({ symbol: "510300.SH", quantity_decimal: "100", averageCost: "4.20" });

    const db = getDatabase();
    const latest = db.prepare("SELECT id FROM portfolio_snapshots WHERE user_id='demo-user' ORDER BY created_at DESC LIMIT 1").get() as { id: string };
    const snapshotHolding = db.prepare("SELECT instrument_id FROM holding_snapshots WHERE portfolio_snapshot_id=? AND instrument_id='510300.SH'").get(latest.id);
    db.close();
    expect(snapshotHolding).toBeTruthy();
  });
});
