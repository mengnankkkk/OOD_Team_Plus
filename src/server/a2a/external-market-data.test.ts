import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prepareDatabase } from "@/server/db/migration-runner";
import { resolveExternalPortfolio } from "./external-market-data";

describe("external A2A market data", () => {
  beforeEach(() => {
    const path = `/tmp/a2a-market-${crypto.randomUUID()}.db`;
    vi.stubEnv("DB_PATH", path);
    const db = new Database(path);
    prepareDatabase(db as never, path);
    db.prepare(`INSERT OR REPLACE INTO instruments (id,symbol,name,market,asset_type,tradable)
      VALUES ('AAPL','AAPL','Apple','NASDAQ','stock',1)`).run();
    db.close();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses server market data instead of caller prices", async () => {
    const call = vi.fn().mockResolvedValue({
      data: [{ symbol: "AAPL", close: "205.50", date: "20260724" }],
      fresh: true,
      asOfDate: "2026-07-24",
      method: "get_us_daily",
    });

    const resolved = await resolveExternalPortfolio({
      cash: "1000",
      holdings: [{ symbol: "AAPL", quantity: "2", cost: "170" }],
    }, { call: call as never });

    expect(resolved.holdings[0]).toMatchObject({
      symbol: "AAPL",
      quantity: "2",
      cost: "170",
      price: "205.50",
      priceSource: "PANDADATA",
      dataAsOf: "2026-07-24",
    });
  });

  it("rejects unresolved instruments", async () => {
    await expect(resolveExternalPortfolio({
      cash: "1000",
      holdings: [{ symbol: "NOT_REAL", quantity: "1", cost: "1" }],
    })).rejects.toMatchObject({ code: "INSTRUMENT_NOT_RESOLVED" });
  });
});
