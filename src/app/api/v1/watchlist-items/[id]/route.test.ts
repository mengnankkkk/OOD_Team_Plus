import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/http/context";
import { authenticatedRequest, seedAuthenticatedUser } from "@tests/helpers/auth";

import { GET } from "./route";

describe("watchlist item GET", () => {
  const userId = "watchlist-item-get-user";
  const context = { params: Promise.resolve({ id: "item-get" }) };

  beforeEach(() => {
    seedAuthenticatedUser({ userId });
    const db = getDatabase();
    db.prepare("DELETE FROM watchlist_items WHERE id = 'item-get'").run();
    db.prepare("DELETE FROM watchlists WHERE id = 'watchlist-item-get' OR user_id = ?").run(userId);
    db.prepare(`INSERT INTO watchlists
      (id,user_id,name,status,created_at,updated_at)
      VALUES ('watchlist-item-get',?,'单条观察','active',?,?)`)
      .run(userId, "2026-07-25T00:00:00.000Z", "2026-07-25T00:00:00.000Z");
    db.prepare(`INSERT INTO watchlist_items
      (id,watchlist_id,instrument_id,source_type,status,added_at,created_at,updated_at)
      VALUES ('item-get','watchlist-item-get','AAPL','user','active',?,?,?)`)
      .run("2026-07-25T00:00:00.000Z", "2026-07-25T00:00:00.000Z", "2026-07-25T00:00:00.000Z");
    db.close();
  });

  it("returns one complete aggregate item", async () => {
    const response = await GET(
      authenticatedRequest("http://localhost/api/v1/watchlist-items/item-get", {}, { userId }),
      context,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: "item-get",
      instrument: { id: "AAPL", symbol: "AAPL", name: "Apple" },
      portfolioRelation: { isHeld: true, quantity: 2, weight: 0.6 },
      market: { status: "insufficient_data", dataAsOf: null },
      valuation: { status: "insufficient_data", dataAsOf: null },
    });
  });
});
