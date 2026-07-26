import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/http/context";
import { seedAuthenticatedUser } from "@tests/helpers/auth";

import { readIndustryConcentration, readPortfolioRelation } from "./aggregation-portfolio";

describe("watchlist portfolio aggregation across active portfolios", () => {
  const userId = "watchlist-multi-portfolio-user";

  beforeEach(() => {
    seedAuthenticatedUser({ userId });
    const db = getDatabase();
    db.prepare(`DELETE FROM holding_snapshots WHERE portfolio_snapshot_id IN (
      SELECT id FROM portfolio_snapshots WHERE user_id=?
    )`).run(userId);
    db.prepare("DELETE FROM portfolio_snapshots WHERE user_id=?").run(userId);
    db.prepare("UPDATE holdings SET status='deleted' WHERE user_id=?").run(userId);
    seedPortfolio(db, {
      portfolioId: "watchlist-portfolio-a",
      snapshotId: "watchlist-snapshot-a",
      asOf: "2026-07-25T08:00:00.000Z",
      totalValue: "600",
      instrumentId: "AAPL",
      quantity: "2",
      cost: "100",
      marketValue: "300",
      pnl: "100",
    });
    seedPortfolio(db, {
      portfolioId: "watchlist-portfolio-b",
      snapshotId: "watchlist-snapshot-b",
      asOf: "2026-07-25T09:00:00.000Z",
      totalValue: "400",
      instrumentId: "MSFT",
      quantity: "1",
      cost: "300",
      marketValue: "400",
      pnl: "100",
    });
    db.close();
  });

  it("does not hide a holding when a newer portfolio snapshot lacks the instrument", () => {
    const db = getDatabase();
    const relation = readPortfolioRelation(db, userId, "AAPL");
    const concentration = readIndustryConcentration(db, userId, "Technology");
    db.close();

    expect(relation).toEqual({
      isHeld: true,
      quantity: 2,
      weight: 0.3,
      cost: 100,
      unrealizedGainPct: 0.5,
      dataAsOf: "2026-07-25T09:00:00.000Z",
    });
    expect(concentration).toMatchObject({
      weight: 0.7,
      level: "critical",
      dataAsOf: "2026-07-25T09:00:00.000Z",
    });
  });

  function seedPortfolio(db: ReturnType<typeof getDatabase>, input: {
    portfolioId: string;
    snapshotId: string;
    asOf: string;
    totalValue: string;
    instrumentId: string;
    quantity: string;
    cost: string;
    marketValue: string;
    pnl: string;
  }): void {
    db.prepare(`INSERT INTO holdings
      (id,user_id,portfolio_id,instrument_id,quantity_decimal,cost_decimal,status,
       created_at,updated_at)
      VALUES (?,?,?,?,'1',?,'active',?,?)`)
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
      .run(input.snapshotId, userId, input.portfolioId, input.totalValue, input.asOf, input.asOf);
    db.prepare(`INSERT INTO holding_snapshots
      (id,portfolio_snapshot_id,instrument_id,quantity_decimal,cost_decimal,price_decimal,
       market_value_decimal,unrealized_pnl_decimal,weight_bps,created_at)
      VALUES (?,?,?,?,?,'150',?,?,5000,?)`)
      .run(
        `${input.snapshotId}-item`,
        input.snapshotId,
        input.instrumentId,
        input.quantity,
        input.cost,
        input.marketValue,
        input.pnl,
        input.asOf,
      );
  }
});
