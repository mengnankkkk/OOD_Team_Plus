import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/http/context";
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
    db.prepare("DELETE FROM observation_conditions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM watchlist_items WHERE id = 'condition-engine-item'").run();
    db.prepare("DELETE FROM watchlists WHERE id = 'condition-engine-list'").run();
    db.prepare(`INSERT INTO watchlists
      (id,user_id,name,status,created_at,updated_at)
      VALUES ('condition-engine-list',?,'规则测试','active',?,?)`).run(userId, now, now);
    db.prepare(`INSERT INTO watchlist_items
      (id,watchlist_id,instrument_id,status,added_at,created_at,updated_at)
      VALUES ('condition-engine-item','condition-engine-list','SPY','active',?,?,?)`).run(now, now, now);
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
