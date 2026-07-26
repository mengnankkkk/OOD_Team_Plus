import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/http/context";
import { authenticatedRequest } from "@tests/helpers/auth";

import { POST } from "./route";

describe("/api/v1/watchlist-items/[id]/check", () => {
  const userId = "watchlist-item-check-owner";
  const now = "2026-07-25T00:00:00.000Z";

  beforeEach(() => {
    const db = getDatabase();
    db.prepare("DELETE FROM idempotency_records WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM watchlist_items WHERE id='item-check-route'").run();
    db.prepare("DELETE FROM watchlists WHERE id='item-check-list'").run();
    db.prepare(`INSERT OR IGNORE INTO users (id,display_name,created_at)
      VALUES (?,'Item Check Owner',?)`).run(userId, now);
    db.prepare(`INSERT INTO watchlists
      (id,user_id,name,status,created_at,updated_at)
      VALUES ('item-check-list',?,'条目检查','active',?,?)`).run(userId, now, now);
    db.prepare(`INSERT INTO watchlist_items
      (id,watchlist_id,instrument_id,status,added_at,created_at,updated_at)
      VALUES ('item-check-route','item-check-list','AAPL','active',?,?,?)`).run(now, now, now);
    db.close();
  });

  it("requires an idempotency key", async () => {
    const response = await POST(
      authenticatedRequest("http://localhost/api/v1/watchlist-items/item-check-route/check", {
        method: "POST",
        body: JSON.stringify({ forceMarketRefresh: false }),
      }, { userId }),
      { params: Promise.resolve({ id: "item-check-route" }) },
    );
    expect(response.status).toBe(400);
  });

  it("saves and replays a scoped item check", async () => {
    const request = () => authenticatedRequest(
      "http://localhost/api/v1/watchlist-items/item-check-route/check",
      {
        method: "POST",
        body: JSON.stringify({ forceMarketRefresh: false }),
        headers: { "Idempotency-Key": "item-check-replay" },
      },
      { userId },
    );
    const first = await POST(request(), { params: Promise.resolve({ id: "item-check-route" }) });
    const second = await POST(request(), { params: Promise.resolve({ id: "item-check-route" }) });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
  });

  it("enforces item ownership", async () => {
    const response = await POST(
      authenticatedRequest("http://localhost/api/v1/watchlist-items/missing/check", {
        method: "POST",
        body: JSON.stringify({ forceMarketRefresh: false }),
        headers: { "Idempotency-Key": "missing-item-check" },
      }, { userId }),
      { params: Promise.resolve({ id: "missing" }) },
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("returns WATCHLIST_ARCHIVED for an item in an archived list", async () => {
    const db = getDatabase();
    db.prepare("UPDATE watchlists SET status='archived' WHERE id='item-check-list'").run();
    db.close();

    const response = await POST(
      authenticatedRequest("http://localhost/api/v1/watchlist-items/item-check-route/check", {
        method: "POST",
        body: JSON.stringify({ forceMarketRefresh: false }),
        headers: { "Idempotency-Key": "archived-item-check" },
      }, { userId }),
      { params: Promise.resolve({ id: "item-check-route" }) },
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("WATCHLIST_ARCHIVED");
  });
});
