import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/http/context";
import { aggregateWatchlistItem } from "@/server/extensions/watchlists/aggregation";
import { seedAuthenticatedUser } from "@tests/helpers/auth";

import {
  dailyMoveEvaluationKey,
  evaluateConditions,
  hasConditionCrossed,
  reviewDateEvaluationKey,
  type ObservationConditionType,
} from "./alert-engine";

describe("structured observation rules", () => {
  it.each([
    ["PRICE_ABOVE", "149", "151", "150"],
    ["PRICE_BELOW", "151", "149", "150"],
    ["DRAWDOWN_REACH", "0.09", "0.12", "0.10"],
    ["POSITION_WEIGHT_ABOVE", "0.29", "0.31", "0.30"],
    ["UNREALIZED_GAIN_REACH", "0.14", "0.16", "0.15"],
  ])("%s triggers only when crossing the threshold", (type, previous, current, threshold) => {
    expect(hasConditionCrossed(type as ObservationConditionType, previous, current, threshold)).toBe(true);
    expect(hasConditionCrossed(type as ObservationConditionType, current, current, threshold)).toBe(false);
    expect(hasConditionCrossed(type as ObservationConditionType, null, current, threshold)).toBe(false);
  });

  it("DAILY_MOVE_REACH can trigger once per trading date", () => {
    expect(dailyMoveEvaluationKey("condition_1", "20260725")).toBe("condition_1:DAILY_MOVE_REACH:20260725");
  });

  it("REVIEW_DATE ignores threshold_decimal and deduplicates by date", () => {
    expect(reviewDateEvaluationKey("condition_1", "2026-07-25")).toBe("condition_1:REVIEW_DATE:2026-07-25");
  });
});

describe("evaluateConditions", () => {
  const userId = "condition-engine-user";
  const now = "2026-07-25T00:00:00.000Z";

  beforeEach(() => {
    seedAuthenticatedUser({ userId });
    const db = getDatabase();
    db.prepare("DELETE FROM observation_condition_events WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM notifications WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM notification_preferences WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM observation_conditions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM market_snapshots WHERE id LIKE 'condition-%'").run();
    db.prepare("DELETE FROM watchlist_items WHERE id = 'condition-engine-item'").run();
    db.prepare("DELETE FROM watchlists WHERE id = 'condition-engine-list'").run();
    db.prepare(`INSERT INTO watchlists
      (id,user_id,name,status,created_at,updated_at)
      VALUES ('condition-engine-list',?,'规则测试','active',?,?)`).run(userId, now, now);
    db.prepare(`INSERT INTO watchlist_items
      (id,watchlist_id,instrument_id,status,added_at,created_at,updated_at)
      VALUES ('condition-engine-item','condition-engine-list','SPY','active',?,?,?)`).run(now, now, now);
    db.prepare(`INSERT INTO notification_preferences
      (id,user_id,mode,created_at,updated_at)
      VALUES ('condition-engine-preference',?,'daily_digest',?,?)`).run(userId, now, now);
    db.close();
  });

  it("returns insufficient_data for a holding-only metric on an unheld item", () => {
    const db = getDatabase();
    db.prepare(`INSERT INTO observation_conditions
      (id,user_id,instrument_id,condition_type,threshold_decimal,status,watchlist_item_id,severity,config_json,created_at,updated_at)
      VALUES ('condition-weight',?,'SPY','POSITION_WEIGHT_ABOVE','0.20','active','condition-engine-item','attention','{}',?,?)`)
      .run(userId, now, now);
    db.close();

    expect(evaluateConditions(["condition-weight"], "test", userId)).toEqual([
      expect.objectContaining({
        conditionId: "condition-weight",
        status: "insufficient_data",
        triggered: false,
        observedValue: null,
      }),
    ]);
  });

  it("does not reuse an older holding snapshot after the instrument was sold", () => {
    const db = getDatabase();
    db.prepare(`INSERT INTO portfolio_snapshots
      (id,user_id,portfolio_id,cash_decimal,total_market_value_decimal,data_quality,source_statuses_json,as_of,created_at)
      VALUES ('condition-old-snapshot',?,'condition-old-portfolio','0','1000','complete','[]',
        '2025-07-25T00:00:00.000Z','2025-07-25T00:00:00.000Z')`).run(userId);
    db.prepare(`INSERT INTO holding_snapshots
      (id,portfolio_snapshot_id,instrument_id,quantity_decimal,cost_decimal,price_decimal,
       market_value_decimal,unrealized_pnl_decimal,weight_bps,created_at)
      VALUES ('condition-old-spy','condition-old-snapshot','SPY','1','400','500','500','100','5000',
        '2025-07-25T00:00:00.000Z')`).run();
    db.prepare(`INSERT INTO observation_conditions
      (id,user_id,instrument_id,condition_type,threshold_decimal,status,watchlist_item_id,severity,
       last_observed_decimal,config_json,created_at,updated_at)
      VALUES ('condition-sold-weight',?,'SPY','POSITION_WEIGHT_ABOVE','0.20','active',
        'condition-engine-item','important','0.10','{}',?,?)`).run(userId, now, now);
    db.close();

    expect(evaluateConditions(["condition-sold-weight"], "test", userId)).toEqual([
      expect.objectContaining({
        conditionId: "condition-sold-weight",
        status: "insufficient_data",
        triggered: false,
        observedValue: null,
      }),
    ]);
  });

  it("alerts again after a reset and a new snapshot crosses the threshold", () => {
    const db = getDatabase();
    db.prepare(`INSERT INTO observation_conditions
      (id,user_id,instrument_id,condition_type,threshold_decimal,status,watchlist_item_id,severity,
       last_observed_decimal,config_json,created_at,updated_at)
      VALUES ('condition-recross',?,'SPY','PRICE_ABOVE','150','active','condition-engine-item',
        'important','149','{}',?,?)`).run(userId, now, now);
    insertMarketSnapshot(db, "condition-recross-up-1", "2026-07-23T08:00:00.000Z", "2026-07-23", 151);
    db.close();

    expect(evaluateConditions(["condition-recross"], "first-cross", userId)[0]?.triggered).toBe(true);

    const resetDb = getDatabase();
    insertMarketSnapshot(resetDb, "condition-recross-reset", "2026-07-24T08:00:00.000Z", "2026-07-24", 149);
    resetDb.close();
    expect(evaluateConditions(["condition-recross"], "reset", userId)[0]?.triggered).toBe(false);

    const recrossDb = getDatabase();
    insertMarketSnapshot(recrossDb, "condition-recross-up-2", "2026-07-25T08:00:00.000Z", "2026-07-25", 151);
    recrossDb.close();
    expect(evaluateConditions(["condition-recross"], "second-cross", userId)[0]?.triggered).toBe(true);

    const verifyDb = getDatabase();
    expect((verifyDb.prepare(`SELECT COUNT(*) AS count FROM observation_condition_events
      WHERE condition_id='condition-recross'`).get() as { count: number }).count).toBe(2);
    verifyDb.close();
  });

  it("uses one evaluation timestamp so every triggered rule is counted for the item", () => {
    const db = getDatabase();
    for (const [id, threshold] of [
      ["condition-count-a", "120"],
      ["condition-count-b", "150"],
    ]) {
      db.prepare(`INSERT INTO observation_conditions
        (id,user_id,instrument_id,condition_type,threshold_decimal,status,watchlist_item_id,severity,
         last_observed_decimal,config_json,created_at,updated_at)
        VALUES (?,?,'SPY','PRICE_ABOVE',?,'active','condition-engine-item',
          'important','100','{}',?,?)`).run(id, userId, threshold, now, now);
    }
    insertMarketSnapshot(db, "condition-count-market", "2026-07-25T09:00:00.000Z", "2026-07-25", 160);
    db.close();

    expect(evaluateConditions(["condition-count-a", "condition-count-b"], "count-test", userId))
      .toEqual([
        expect.objectContaining({ triggered: true }),
        expect.objectContaining({ triggered: true }),
      ]);
    expect(aggregateWatchlistItem(userId, "condition-engine-item").triggeredConditionCount).toBe(2);
  });

  it("triggers a due review date once", () => {
    const db = getDatabase();
    db.prepare(`INSERT INTO observation_conditions
      (id,user_id,instrument_id,condition_type,threshold_decimal,status,watchlist_item_id,severity,
       threshold_date,config_json,created_at,updated_at)
      VALUES ('condition-review',?,'SPY','REVIEW_DATE','0','active','condition-engine-item',
       'attention','2020-01-01','{}',?,?)`).run(userId, now, now);
    db.close();

    const first = evaluateConditions(["condition-review"], "test", userId);
    const second = evaluateConditions(["condition-review"], "test", userId);

    expect(first).toEqual([
      expect.objectContaining({ conditionId: "condition-review", status: "evaluated", triggered: true }),
    ]);
    expect(second).toEqual([
      expect.objectContaining({ conditionId: "condition-review", triggered: false, duplicate: true }),
    ]);
    const verifyDb = getDatabase();
    expect((verifyDb.prepare(`SELECT COUNT(*) AS count FROM notifications
      WHERE user_id=? AND condition_id='condition-review'`).get(userId) as { count: number }).count).toBe(1);
    verifyDb.close();
  });
});

function insertMarketSnapshot(
  db: ReturnType<typeof getDatabase>,
  id: string,
  asOf: string,
  tradingDate: string,
  close: number,
): void {
  db.prepare(`INSERT INTO market_snapshots
    (id,instrument_id,data_source_id,snapshot_type,as_of,trading_date,market_timezone,
     freshness_status,quality_status,raw_payload_json,created_at)
    VALUES (?,'SPY','source-pandadata-api','daily',?,?,'America/New_York',
      'fresh','valid',?,?)`)
    .run(id, asOf, tradingDate, JSON.stringify({ date: tradingDate, close }), asOf);
}
