import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/http/context";
import { seedAuthenticatedUser } from "@tests/helpers/auth";

import { evaluateConditions } from "./alert-engine";

describe("condition evaluation failure isolation", () => {
  const userId = "condition-failure-user";
  const now = "2026-07-25T00:00:00.000Z";

  beforeEach(() => {
    seedAuthenticatedUser({ userId });
    const db = getDatabase();
    db.prepare("DELETE FROM observation_condition_events WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM notifications WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM observation_conditions WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM notification_preferences WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM market_snapshots WHERE id='condition-failure-market'").run();
    db.prepare("DELETE FROM watchlist_items WHERE id='condition-failure-item'").run();
    db.prepare("DELETE FROM watchlists WHERE id='condition-failure-list'").run();
    db.prepare(`INSERT INTO watchlists
      (id,user_id,name,status,created_at,updated_at)
      VALUES ('condition-failure-list',?,'失败隔离','active',?,?)`).run(userId, now, now);
    db.prepare(`INSERT INTO watchlist_items
      (id,watchlist_id,instrument_id,status,added_at,created_at,updated_at)
      VALUES ('condition-failure-item','condition-failure-list','SPY','active',?,?,?)`)
      .run(now, now, now);
    db.prepare(`INSERT INTO notification_preferences
      (id,user_id,mode,created_at,updated_at)
      VALUES ('condition-failure-preference',?,'daily_digest',?,?)`).run(userId, now, now);
    db.prepare(`INSERT INTO market_snapshots
      (id,instrument_id,data_source_id,snapshot_type,as_of,trading_date,market_timezone,
       freshness_status,quality_status,raw_payload_json,created_at)
      VALUES ('condition-failure-market','SPY','source-pandadata-api','daily',
        '2026-07-25T11:00:00.000Z','2026-07-25','America/New_York','fresh','valid',
        '{"date":"2026-07-25","close":151}','2026-07-25T11:00:00.000Z')`).run();
    db.close();
  });

  it("rolls back one failed event and allows a retry", () => {
    insertCondition("condition-atomic");
    const db = getDatabase();
    db.exec(`CREATE TRIGGER condition_atomic_notification_failure
      BEFORE INSERT ON notifications WHEN NEW.condition_id='condition-atomic' BEGIN
        SELECT RAISE(ABORT, 'forced notification failure');
      END`);
    db.close();

    expect(evaluateConditions(["condition-atomic"], "test", userId)[0])
      .toMatchObject({ status: "failed", triggered: false });
    const failedDb = getDatabase();
    expect((failedDb.prepare(`SELECT COUNT(*) AS count FROM observation_condition_events
      WHERE condition_id='condition-atomic'`).get() as { count: number }).count).toBe(0);
    failedDb.exec("DROP TRIGGER condition_atomic_notification_failure");
    failedDb.close();
    expect(evaluateConditions(["condition-atomic"], "retry", userId)[0]?.triggered).toBe(true);
  });

  it("continues evaluating later rules after one failure", () => {
    for (const id of ["condition-batch-a", "condition-batch-b", "condition-batch-c"]) {
      insertCondition(id);
    }
    const db = getDatabase();
    db.exec(`CREATE TRIGGER condition_batch_notification_failure
      BEFORE INSERT ON notifications WHEN NEW.condition_id='condition-batch-b' BEGIN
        SELECT RAISE(ABORT, 'forced batch notification failure');
      END`);
    db.close();

    const results = evaluateConditions(
      ["condition-batch-a", "condition-batch-b", "condition-batch-c"],
      "batch-test",
      userId,
    );

    expect(results).toEqual([
      expect.objectContaining({ conditionId: "condition-batch-a", triggered: true }),
      expect.objectContaining({ conditionId: "condition-batch-b", status: "failed" }),
      expect.objectContaining({ conditionId: "condition-batch-c", triggered: true }),
    ]);
    const verifyDb = getDatabase();
    verifyDb.exec("DROP TRIGGER condition_batch_notification_failure");
    verifyDb.close();
  });

  function insertCondition(id: string): void {
    const db = getDatabase();
    db.prepare(`INSERT INTO observation_conditions
      (id,user_id,instrument_id,condition_type,threshold_decimal,status,watchlist_item_id,
       severity,last_observed_decimal,config_json,created_at,updated_at)
      VALUES (?,?,'SPY','PRICE_ABOVE','150','active','condition-failure-item',
        'important','149','{}',?,?)`).run(id, userId, now, now);
    db.close();
  }
});
