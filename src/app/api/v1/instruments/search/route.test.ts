import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDatabase } from "@/server/http/context";
import { GET } from "./route";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-instrument-search-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* SQLite can release handles after teardown. */ }
  }
});

describe("/api/v1/instruments/search", () => {
  it("keeps a matching stock visible when many matching ETFs exceed the result limit", async () => {
    const db = getDatabase();
    const insert = db.prepare("INSERT INTO instruments (id,symbol,name,market,asset_type,sector,tradable) VALUES (?,?,?,?,?,?,1)");
    for (let index = 0; index < 12; index += 1) {
      insert.run(`fund-${index}`, `51${String(index).padStart(4, "0")}`, `平安主题ETF${index}`, "SH", "index", null);
    }
    insert.run("stock-000001", "000001", "平安银行", "SZ", "stock", "银行");
    db.close();

    const response = await GET(new NextRequest("http://localhost/api/v1/instruments/search?q=%E5%B9%B3%E5%AE%89&limit=8"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toHaveLength(8);
    expect(body.data.items[0]).toMatchObject({
      symbol: "000001",
      name: "平安银行",
      assetType: "STOCK",
    });
  });

  it("returns cursor pagination metadata and advances to a non-overlapping page", async () => {
    const db = getDatabase();
    const insert = db.prepare("INSERT INTO instruments (id,symbol,name,market,asset_type,sector,tradable) VALUES (?,?,?,?,?,?,1)");
    for (let index = 0; index < 12; index += 1) {
      insert.run(`page-fund-${index}`, `52${String(index).padStart(4, "0")}`, `平安分页ETF${index}`, "SH", "index", null);
    }
    insert.run("page-stock-000001", "000001", "平安银行", "SZ", "stock", "银行");
    db.close();

    const firstResponse = await GET(new NextRequest("http://localhost/api/v1/instruments/search?q=%E5%B9%B3%E5%AE%89&limit=5"));
    const firstBody = await firstResponse.json();
    const secondResponse = await GET(new NextRequest("http://localhost/api/v1/instruments/search?q=%E5%B9%B3%E5%AE%89&limit=5&cursor=5"));
    const secondBody = await secondResponse.json();

    expect(firstBody.data.pagination).toEqual({
      limit: 5,
      nextCursor: "5",
      hasMore: true,
      total: 13,
    });
    expect(secondBody.data.pagination).toEqual({
      limit: 5,
      nextCursor: "10",
      hasMore: true,
      total: 13,
    });
    expect(secondBody.data.items.map((item: { symbol: string }) => item.symbol))
      .not.toEqual(expect.arrayContaining(firstBody.data.items.map((item: { symbol: string }) => item.symbol)));
  });
});
