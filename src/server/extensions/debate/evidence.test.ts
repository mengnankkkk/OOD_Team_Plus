import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { seedAuthenticatedUser, TEST_USER_ID } from "@tests/helpers/auth";
import { getDatabase } from "@/server/http/context";

import { buildDebateEvidenceBoard } from "./evidence";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-debate-evidence-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
  seedAuthenticatedUser();
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
});

describe("debate evidence board", () => {
  it("loads profile, latest holdings, and user claims into one shared board", async () => {
    const db = getDatabase();
    db.prepare("DELETE FROM holding_snapshots").run();
    db.prepare("DELETE FROM portfolio_snapshots WHERE user_id=?").run(TEST_USER_ID);
    db.prepare(`INSERT INTO user_profiles
      (id,user_id,risk_level,investment_amount_decimal,horizon,max_drawdown_decimal,preferences_json,status,created_at,updated_at)
      VALUES ('profile_1',?,'BALANCED','10000','MEDIUM','0.1','{}','active','2026-07-25T00:00:00.000Z','2026-07-25T00:00:00.000Z')`).run(TEST_USER_ID);
    db.prepare(`INSERT INTO instruments
      (id,symbol,name,market,asset_type,tradable)
      VALUES ('instrument_510300','510300.OF','沪深300ETF','OF','ETF',1)`).run();
    db.prepare(`INSERT INTO portfolio_snapshots
      (id,user_id,portfolio_id,cash_decimal,total_market_value_decimal,data_quality,source_statuses_json,as_of,created_at)
      VALUES ('snapshot_1',?,'portfolio_1','5000','10000','complete','[]','2026-07-25T00:00:00.000Z','2026-07-25T00:00:00.000Z')`).run(TEST_USER_ID);
    db.prepare(`INSERT INTO holding_snapshots
      (id,portfolio_snapshot_id,instrument_id,quantity_decimal,cost_decimal,price_decimal,market_value_decimal,unrealized_pnl_decimal,weight_bps,created_at)
      VALUES ('holding_1','snapshot_1','instrument_510300','100','3','2.8','280','-20',280,'2026-07-25T00:00:00.000Z')`).run();
    db.close();

    const dbCall = vi.fn(async () => []);
    const board = await buildDebateEvidenceBoard({
      userId: TEST_USER_ID,
      debateSessionId: "debate_1",
      rootAgentRunId: "analysis_1",
      motion: "是否加仓 510300",
      targetSymbol: "510300.OF",
      userClaims: ["我只打算持有两周"],
      dbCall,
    });

    expect(board.profileFacts.some((item) => item.includes("BALANCED"))).toBe(true);
    expect(board.portfolioFacts.some((item) => item.includes("510300.OF"))).toBe(true);
    expect(board.userClaims).toEqual(["我只打算持有两周"]);
    expect(dbCall).toHaveBeenCalledWith(expect.objectContaining({
      sources: [expect.objectContaining({ method: "get_fund_daily" })],
      agentRunId: "analysis_1",
    }));
    expect(board.missingData).toContain("market_data");
  });

  it("marks unavailable facts without fabricating market evidence", async () => {
    const db = getDatabase();
    db.prepare("DELETE FROM holding_snapshots").run();
    db.prepare("DELETE FROM portfolio_snapshots WHERE user_id=?").run(TEST_USER_ID);
    db.prepare(`INSERT INTO instruments
      (id,symbol,name,market,asset_type,tradable)
      VALUES ('instrument_aapl','AAPL.US','Apple','US','STOCK',1)`).run();
    db.close();

    const board = await buildDebateEvidenceBoard({
      userId: TEST_USER_ID,
      debateSessionId: "debate_2",
      rootAgentRunId: "analysis_2",
      motion: "AAPL 是否值得继续研究",
      targetSymbol: "AAPL.US",
      userClaims: ["我最多能接受 5% 回撤"],
      dbCall: async () => {
        throw new Error("PANDADATA_UNAVAILABLE");
      },
    });

    expect(board.marketFacts).toEqual([]);
    expect(board.pandaExecutions).toEqual([]);
    expect(board.userClaims).toEqual(["我最多能接受 5% 回撤"]);
    expect(board.missingData).toEqual(expect.arrayContaining(["profile", "holdings", "market_data"]));
  });
});
