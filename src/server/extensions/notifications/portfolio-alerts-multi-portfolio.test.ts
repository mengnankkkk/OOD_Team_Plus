import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/http/context";
import { seedAuthenticatedUser } from "@tests/helpers/auth";

import { createPortfolioNotifications } from "./portfolio-alerts";

describe("portfolio alerts across active portfolios", () => {
  const userId = "portfolio-alerts-multi-user";
  const now = "2026-07-25T08:00:00.000Z";

  beforeEach(() => {
    seedAuthenticatedUser({ userId });
    const db = getDatabase();
    db.prepare("DELETE FROM notifications WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM notification_preferences WHERE user_id=?").run(userId);
    db.prepare(`DELETE FROM holding_snapshots WHERE portfolio_snapshot_id IN (
      SELECT id FROM portfolio_snapshots WHERE user_id=?
    )`).run(userId);
    db.prepare("DELETE FROM portfolio_snapshots WHERE user_id=?").run(userId);
    db.prepare("UPDATE holdings SET status='deleted' WHERE user_id=?").run(userId);
    db.prepare(`INSERT INTO notification_preferences
      (id,user_id,mode,created_at,updated_at)
      VALUES ('portfolio-alerts-multi-preference',?,'daily_digest',?,?)`)
      .run(userId, now, now);
    seedPortfolio(db, {
      portfolioId: "portfolio-alerts-a",
      snapshotId: "portfolio-alerts-snapshot-a",
      asOf: "2026-07-25T08:00:00.000Z",
      instrumentId: "SPY",
      cost: "100",
      price: "75",
    });
    seedPortfolio(db, {
      portfolioId: "portfolio-alerts-b",
      snapshotId: "portfolio-alerts-snapshot-b",
      asOf: "2026-07-25T09:00:00.000Z",
      instrumentId: "AAPL",
      cost: "100",
      price: "100",
    });
    db.close();
  });

  it("creates an alert for a losing holding outside the globally newest portfolio", () => {
    createPortfolioNotifications(userId);

    const db = getDatabase();
    const alert = db.prepare(`SELECT source_id,metadata_json FROM notifications
      WHERE user_id=? AND source_type='PORTFOLIO_RISK' AND source_id='SPY'`)
      .get(userId) as { metadata_json: string; source_id: string } | undefined;
    db.close();
    expect(alert?.source_id).toBe("SPY");
    expect(JSON.parse(alert!.metadata_json)).toMatchObject({
      instrumentId: "SPY",
      portfolioId: "portfolio-alerts-a",
    });
  });

  function seedPortfolio(db: ReturnType<typeof getDatabase>, input: {
    portfolioId: string;
    snapshotId: string;
    asOf: string;
    instrumentId: string;
    cost: string;
    price: string;
  }): void {
    const marketValue = String(Number(input.price) * 2);
    const pnl = String((Number(input.price) - Number(input.cost)) * 2);
    db.prepare(`INSERT INTO holdings
      (id,user_id,portfolio_id,instrument_id,quantity_decimal,cost_decimal,status,
       created_at,updated_at)
      VALUES (?,?,?,?,'2',?,'active',?,?)`)
      .run(
        `${input.snapshotId}-holding`,
        userId,
        input.portfolioId,
        input.instrumentId,
        input.cost,
        input.asOf,
        input.asOf,
      );
    db.prepare(`INSERT INTO portfolio_snapshots
      (id,user_id,portfolio_id,cash_decimal,total_market_value_decimal,data_quality,
       source_statuses_json,as_of,created_at)
      VALUES (?,?,?,'0',?,'complete','[]',?,?)`)
      .run(input.snapshotId, userId, input.portfolioId, marketValue, input.asOf, input.asOf);
    db.prepare(`INSERT INTO holding_snapshots
      (id,portfolio_snapshot_id,instrument_id,quantity_decimal,cost_decimal,price_decimal,
       market_value_decimal,unrealized_pnl_decimal,weight_bps,created_at)
      VALUES (?,?,?,'2',?,?,?,?,10000,?)`)
      .run(
        `${input.snapshotId}-item`,
        input.snapshotId,
        input.instrumentId,
        input.cost,
        input.price,
        marketValue,
        pnl,
        input.asOf,
      );
  }
});
