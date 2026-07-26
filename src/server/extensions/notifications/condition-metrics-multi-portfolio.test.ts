import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/http/context";
import { seedAuthenticatedUser } from "@tests/helpers/auth";

import { readObservedMetric, type ConditionRow } from "./condition-metrics";

describe("holding condition metrics across portfolios", () => {
  const userId = "condition-multi-portfolio-user";

  beforeEach(() => {
    seedAuthenticatedUser({ userId });
    const db = getDatabase();
    db.prepare(`DELETE FROM holding_snapshots WHERE portfolio_snapshot_id IN (
      SELECT id FROM portfolio_snapshots WHERE user_id=?
    )`).run(userId);
    db.prepare("DELETE FROM portfolio_snapshots WHERE user_id=?").run(userId);
    db.prepare("UPDATE holdings SET status='deleted' WHERE user_id=?").run(userId);
    for (const [snapshotId, portfolioId, asOf, totalValue, marketValue, quantity, cost, pnl] of [
      ["condition-portfolio-a", "portfolio-a", "2026-07-25T08:00:00.000Z", "600", "300", "2", "100", "100"],
      ["condition-portfolio-b", "portfolio-b", "2026-07-25T09:00:00.000Z", "400", "100", "1", "80", "20"],
    ]) {
      db.prepare(`INSERT INTO portfolio_snapshots
        (id,user_id,portfolio_id,cash_decimal,total_market_value_decimal,data_quality,
         source_statuses_json,as_of,created_at)
        VALUES (?,?,?,'0',?,'complete','[]',?,?)`)
        .run(snapshotId, userId, portfolioId, totalValue, asOf, asOf);
      db.prepare(`INSERT INTO holding_snapshots
        (id,portfolio_snapshot_id,instrument_id,quantity_decimal,cost_decimal,price_decimal,
         market_value_decimal,unrealized_pnl_decimal,weight_bps,created_at)
        VALUES (?,?,'SPY',?,?,'150',?,?,5000,?)`)
        .run(`${snapshotId}-spy`, snapshotId, quantity, cost, marketValue, pnl, asOf);
      db.prepare(`INSERT INTO holdings
        (id,user_id,portfolio_id,instrument_id,quantity_decimal,cost_decimal,status,
         created_at,updated_at)
        VALUES (?,?,?,'SPY',?,?,'active',?,?)`)
        .run(`${snapshotId}-holding`, userId, portfolioId, quantity, cost, asOf, asOf);
    }
    db.close();
  });

  it("aggregates weight and unrealized gain from every current portfolio", () => {
    const db = getDatabase();
    const condition = (conditionType: ConditionRow["condition_type"]): ConditionRow => ({
      id: `condition-${conditionType}`,
      user_id: userId,
      instrument_id: "SPY",
      condition_type: conditionType,
    });

    const weight = readObservedMetric(db, condition("POSITION_WEIGHT_ABOVE"));
    const gain = readObservedMetric(db, condition("UNREALIZED_GAIN_REACH"));
    db.close();

    expect(weight.value?.toDecimalPlaces(8).toString()).toBe("0.4");
    expect(gain.value?.toDecimalPlaces(8).toString()).toBe("0.42857143");
    expect(weight.metricSnapshot).toMatchObject({
      portfolioSnapshotIds: ["condition-portfolio-a", "condition-portfolio-b"],
    });
  });
});
