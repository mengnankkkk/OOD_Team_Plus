import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TEST_USER_ID, authenticatedRequest } from "@tests/helpers/auth";
import { getDatabase } from "@/server/http/context";
import { GET } from "./route";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-holdings-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* SQLite can release handles after teardown. */ }
  }
});

describe("/api/v1/holdings", () => {
  it("returns instrument industry and the latest market price separately from user cost", async () => {
    const db = getDatabase();
    db.prepare("INSERT INTO instruments (id,symbol,name,market,asset_type,sector,tradable) VALUES (?,?,?,?,?,?,1)")
      .run("000001.SZ", "000001.SZ", "平安银行", "SZ", "stock", "银行");
    db.prepare("INSERT INTO holdings (id,user_id,portfolio_id,instrument_id,quantity_decimal,cost_decimal,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,'active',1,?,?)")
      .run("holding-pingan", TEST_USER_ID, "portfolio-demo", "000001.SZ", "100", "10.00", "2026-07-25T01:00:00.000Z", "2026-07-25T01:00:00.000Z");
    db.prepare("INSERT INTO portfolio_snapshots (id,user_id,portfolio_id,cash_decimal,total_market_value_decimal,data_quality,source_statuses_json,as_of,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run("snapshot-pingan", TEST_USER_ID, "portfolio-demo", "0", "1234", "complete", "[]", "2026-07-25T02:00:00.000Z", "2026-07-25T02:00:00.000Z");
    db.prepare("INSERT INTO holding_snapshots (id,portfolio_snapshot_id,instrument_id,quantity_decimal,cost_decimal,price_decimal,market_value_decimal,unrealized_pnl_decimal,weight_bps,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run("holding-snapshot-pingan", "snapshot-pingan", "000001.SZ", "100", "10.00", "12.34", "1234", "234", 10000, "2026-07-25T02:00:00.000Z");
    db.close();

    const response = await GET(authenticatedRequest("http://localhost/api/v1/holdings"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items.find((item: { id: string }) => item.id === "holding-pingan")).toMatchObject({
      symbol: "000001.SZ",
      name: "平安银行",
      asset_type: "stock",
      sector: "银行",
      quantity_decimal: "100",
      cost_decimal: "10.00",
      current_price_decimal: "12.34",
      market_value_decimal: "1234",
      price_as_of: "2026-07-25T02:00:00.000Z",
    });
  });
});
