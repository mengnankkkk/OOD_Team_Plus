import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/http/context";
import { seedAuthenticatedUser } from "@tests/helpers/auth";

import { checkWatchlist, checkWatchlistItem } from "./check-service";

describe("scoped watchlist checks", () => {
  const userId = "watchlist-check-user";
  const now = "2026-07-25T00:00:00.000Z";
  const originalEnv = {
    username: process.env.DEFAULT_USERNAME,
    password: process.env.DEFAULT_PASSWORD,
    baseUrl: process.env.JAVA_SERVICE_BASE_URL,
  };

  beforeEach(() => {
    process.env.DEFAULT_USERNAME = "your_value_here";
    process.env.DEFAULT_PASSWORD = "your_value_here";
    process.env.JAVA_SERVICE_BASE_URL = "your_value_here";
    seedAuthenticatedUser({ userId });
    const db = getDatabase();
    db.prepare("DELETE FROM observation_condition_events WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM notifications WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM observation_conditions WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM watchlist_items WHERE id IN ('check-item-a','check-item-b')").run();
    db.prepare("DELETE FROM watchlists WHERE id IN ('check-list-a','check-list-b')").run();
    db.prepare(`INSERT INTO watchlists
      (id,user_id,name,status,created_at,updated_at) VALUES
      ('check-list-a',?,'检查列表 A','active',?,?),
      ('check-list-b',?,'检查列表 B','active',?,?)`).run(userId, now, now, userId, now, now);
    db.prepare(`INSERT INTO watchlist_items
      (id,watchlist_id,instrument_id,status,added_at,created_at,updated_at) VALUES
      ('check-item-a','check-list-a','AAPL','active',?,?,?),
      ('check-item-b','check-list-b','MSFT','active',?,?,?)`).run(now, now, now, now, now, now);
    for (const [conditionId, itemId, instrumentId] of [
      ["check-condition-a", "check-item-a", "AAPL"],
      ["check-condition-b", "check-item-b", "MSFT"],
    ]) {
      db.prepare(`INSERT INTO observation_conditions
        (id,user_id,instrument_id,condition_type,threshold_decimal,status,watchlist_item_id,severity,
         threshold_date,config_json,created_at,updated_at)
        VALUES (?,?,?,'REVIEW_DATE','0','active',?,'attention','2020-01-01','{}',?,?)`)
        .run(conditionId, userId, instrumentId, itemId, now, now);
    }
    db.close();
  });

  afterEach(() => {
    restoreEnv("DEFAULT_USERNAME", originalEnv.username);
    restoreEnv("DEFAULT_PASSWORD", originalEnv.password);
    restoreEnv("JAVA_SERVICE_BASE_URL", originalEnv.baseUrl);
  });

  it("checks one item without evaluating another list", async () => {
    const result = await checkWatchlistItem(userId, "check-item-a", { forceMarketRefresh: false });

    expect(result.checkedItemCount).toBe(1);
    expect(result.itemIds).toEqual(["check-item-a"]);
    const db = getDatabase();
    const rows = db.prepare(`SELECT id,last_evaluated_at FROM observation_conditions
      WHERE id IN ('check-condition-a','check-condition-b') ORDER BY id`).all();
    db.close();
    expect(rows).toEqual([
      expect.objectContaining({ id: "check-condition-a", last_evaluated_at: expect.any(String) }),
      { id: "check-condition-b", last_evaluated_at: null },
    ]);
  });

  it("checks an active list and returns partial status when market refresh is unavailable", async () => {
    const result = await checkWatchlist(userId, "check-list-a", { forceMarketRefresh: true });

    expect(result).toMatchObject({
      status: "PARTIAL",
      checkedItemCount: 1,
      itemIds: ["check-item-a"],
      marketRefreshAttempted: true,
      marketRefreshSucceeded: false,
      errorCode: "PANDADATA_NOT_CONFIGURED",
    });
  });

  it("continues a list check when one rule fails", async () => {
    const db = getDatabase();
    db.prepare(`UPDATE observation_conditions
      SET condition_type='PRICE_ABOVE',threshold_decimal='150',threshold_date=NULL,
        severity='important',last_observed_decimal='149'
      WHERE id='check-condition-a'`).run();
    db.prepare(`INSERT INTO observation_conditions
      (id,user_id,instrument_id,condition_type,threshold_decimal,status,watchlist_item_id,severity,
       last_observed_decimal,config_json,created_at,updated_at)
      VALUES ('check-condition-a-failed',?,'AAPL','PRICE_ABOVE','150','active',
        'check-item-a','important','149','{}',?,?)`).run(userId, now, now);
    db.prepare(`INSERT INTO market_snapshots
      (id,instrument_id,data_source_id,snapshot_type,as_of,trading_date,market_timezone,
       freshness_status,quality_status,raw_payload_json,created_at)
      VALUES ('check-market-a','AAPL','source-pandadata-api','daily',
        '2026-07-25T08:00:00.000Z','2026-07-25','America/New_York','fresh','valid',
        '{"date":"2026-07-25","close":151}','2026-07-25T08:00:00.000Z')`).run();
    db.exec(`CREATE TRIGGER check_rule_notification_failure
      BEFORE INSERT ON notifications
      WHEN NEW.condition_id = 'check-condition-a-failed'
      BEGIN
        SELECT RAISE(ABORT, 'forced watchlist rule failure');
      END`);
    db.close();

    const result = await checkWatchlist(userId, "check-list-a", {
      forceMarketRefresh: false,
    });

    const cleanupDb = getDatabase();
    cleanupDb.exec("DROP TRIGGER check_rule_notification_failure");
    cleanupDb.close();
    expect(result).toMatchObject({
      status: "PARTIAL",
      evaluatedConditionCount: 1,
      errorCode: "WATCHLIST_EVALUATION_PARTIAL",
    });
  });

  it("revalidates scope after refresh before creating side effects", async () => {
    process.env.DEFAULT_USERNAME = "configured";
    process.env.DEFAULT_PASSWORD = "configured";
    process.env.JAVA_SERVICE_BASE_URL = "https://pandadata.example";
    const result = await checkWatchlist(userId, "check-list-a", {
      forceMarketRefresh: true,
      refreshMarket: async () => {
        const db = getDatabase();
        db.prepare("UPDATE watchlists SET status='archived' WHERE id='check-list-a'").run();
        db.close();
        return {
          succeededGroupCount: 1,
          failedGroupCount: 0,
          complete: true,
          errorCode: null,
        };
      },
    });

    expect(result.checkedItemCount).toBe(0);
    const db = getDatabase();
    const condition = db.prepare("SELECT last_evaluated_at FROM observation_conditions WHERE id='check-condition-a'")
      .get() as { last_evaluated_at: string | null };
    const notifications = db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id=?")
      .get(userId) as { count: number };
    db.close();
    expect(condition.last_evaluated_at).toBeNull();
    expect(notifications.count).toBe(0);
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
