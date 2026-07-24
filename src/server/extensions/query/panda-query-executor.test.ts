import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prepareDatabase } from "@/server/db/migration-runner";
import { ensureRuntimeSchema } from "@/server/db/runtime-schema";
import type { PandaDataResult } from "@/server/extensions/pandadata/adapter";

import { combineQueryResults, executePandaSources } from "./panda-query-executor";

describe("PandaData QueryPlan execution", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    ensureRuntimeSchema(db as never);
    prepareDatabase(db as never, ":memory:");
    db.prepare("INSERT INTO agent_runs (id,user_id,type,status,created_at) VALUES ('run1','user1','data_query','running',?)")
      .run(new Date().toISOString());
  });

  it("persists real tool, skill and market snapshot links", async () => {
    const call = vi.fn().mockResolvedValue(pandaResult([
      { symbol: "000001.SZ", date: "20260724", close: "12.30", volume: "1000" },
    ]));

    const executions = await executePandaSources({
      sources: [{
        dataset: "MARKET_STOCK_DAILY",
        method: "get_stock_daily",
        parameters: { symbol: ["000001.SZ"], start_date: "20260701", end_date: "20260724", fields: [] },
        columns: ["symbol", "date", "close"],
        joinKeys: ["symbol", "date"],
        assetType: "STOCK",
      }],
      agentRunId: "run1",
      localRows: [],
      db: db as never,
      call,
    });

    expect(executions).toHaveLength(1);
    expect(db.prepare("SELECT status,tool_name FROM tool_calls").get()).toEqual({ status: "succeeded", tool_name: "get_stock_daily" });
    expect(db.prepare("SELECT status,method_name,quality_status FROM skill_runs").get()).toEqual({ status: "succeeded", method_name: "get_stock_daily", quality_status: "valid" });
    expect(db.prepare("SELECT source_method,freshness_status FROM market_snapshots").get()).toEqual({ source_method: "get_stock_daily", freshness_status: "fresh" });
    expect(db.prepare("SELECT value_decimal FROM market_snapshot_metrics WHERE metric_code='close'").get()).toEqual({ value_decimal: "12.3" });
    expect(db.prepare("SELECT phase,status FROM pandadata_probes ORDER BY phase").all()).toEqual([
      { phase: "dry_run", status: "succeeded" },
      { phase: "live_call", status: "succeeded" },
    ]);
  });

  it("uses local symbols and joins external rows in application memory", async () => {
    const call = vi.fn().mockResolvedValue(pandaResult([
      { symbol: "AAPL", date: "20260724", close: "220.5" },
    ]));
    const executions = await executePandaSources({
      sources: [{
        dataset: "MARKET_US_DAILY",
        method: "get_us_daily",
        parameters: { start_date: "20260701", end_date: "20260724", fields: [] },
        columns: ["symbol", "date", "close"],
        joinKeys: ["symbol", "date"],
        assetType: "STOCK",
      }],
      agentRunId: "run1",
      localRows: [{ symbol: "AAPL", quantity: "10" }],
      db: db as never,
      call,
    });
    expect(call).toHaveBeenCalledWith("get_us_daily", expect.objectContaining({ symbol: ["AAPL"] }));

    const combined = combineQueryResults({
      rows: [{ symbol: "AAPL", quantity: "10" }],
      columns: [{ name: "symbol", type: "TEXT" }, { name: "quantity", type: "TEXT" }],
      rowCount: 1,
      isTruncated: false,
      resultSizeBytes: 10,
    }, executions, 100);
    expect(combined.rows[0]).toEqual(expect.objectContaining({ symbol: "AAPL", quantity: "10", close: "220.5" }));
  });
});

function pandaResult(data: Array<Record<string, unknown>>): PandaDataResult {
  return {
    data,
    method: "get_stock_daily",
    callDurationMs: 12,
    dryRunDurationMs: 4,
    liveCallDurationMs: 8,
    contractValidated: true,
    dryRunSucceeded: true,
    liveCallSucceeded: true,
    fresh: true,
    asOfDate: "2026-07-24",
    errorCategory: null,
    contractExcerpt: "contract",
  };
}
