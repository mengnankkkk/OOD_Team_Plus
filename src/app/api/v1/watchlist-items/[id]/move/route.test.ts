import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/http/context";
import { authenticatedRequest, seedAuthenticatedUser } from "@tests/helpers/auth";

import { POST } from "./route";

describe("/api/v1/watchlist-items/[id]/move", () => {
  const userId = "watchlist-move-route-user";
  const now = "2026-07-25T00:00:00.000Z";

  beforeEach(() => {
    seedAuthenticatedUser({ userId });
    const db = getDatabase();
    db.prepare("DELETE FROM watchlist_items WHERE watchlist_id IN ('wl-move-source','wl-move-target')").run();
    db.prepare("DELETE FROM watchlists WHERE id IN ('wl-move-source','wl-move-target') OR user_id = ?").run(userId);
    db.prepare(`INSERT INTO watchlists
      (id,user_id,name,status,created_at,updated_at) VALUES
      ('wl-move-source',?,'来源列表','active',?,?),
      ('wl-move-target',?,'目标列表','active',?,?)`).run(userId, now, now, userId, now, now);
    db.prepare(`INSERT INTO watchlist_items
      (id,watchlist_id,instrument_id,status,added_at,created_at,updated_at,row_version)
      VALUES ('wi-move','wl-move-source','AAPL','active',?,?,?,1)`).run(now, now, now);
    db.close();
  });

  it("moves an item to another active list", async () => {
    const response = await POST(
      authenticatedRequest("http://localhost/api/v1/watchlist-items/wi-move/move", {
        method: "POST",
        body: JSON.stringify({ targetWatchlistId: "wl-move-target" }),
        headers: { "If-Match": "1" },
      }, { userId }),
      { params: Promise.resolve({ id: "wi-move" }) },
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ id: "wi-move", watchlistId: "wl-move-target", version: 2 });
  });

  it("returns the conflicting target item id", async () => {
    const db = getDatabase();
    db.prepare(`INSERT INTO watchlist_items
      (id,watchlist_id,instrument_id,status,added_at,created_at,updated_at,row_version)
      VALUES ('wi-move-existing','wl-move-target','AAPL','active',?,?,?,1)`).run(now, now, now);
    db.close();

    const response = await POST(
      authenticatedRequest("http://localhost/api/v1/watchlist-items/wi-move/move", {
        method: "POST",
        body: JSON.stringify({ targetWatchlistId: "wl-move-target" }),
        headers: { "If-Match": "1" },
      }, { userId }),
      { params: Promise.resolve({ id: "wi-move" }) },
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatchObject({
      code: "WATCHLIST_ITEM_MOVE_CONFLICT",
      details: { existingItemId: "wi-move-existing" },
    });
  });
});
