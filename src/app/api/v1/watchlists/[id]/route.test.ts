import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/http/context";
import { authenticatedRequest, seedAuthenticatedUser } from "@tests/helpers/auth";
import { DELETE, GET, PATCH } from "./route";

const url = "http://localhost/api/v1/watchlists/wl_1";

describe("/api/v1/watchlists/[id]", () => {
  const userId = "watchlist-detail-route-user";

  beforeEach(() => {
    seedAuthenticatedUser({ userId });
    const db = getDatabase();
    db.prepare("DELETE FROM observation_conditions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM watchlist_items WHERE watchlist_id IN (SELECT id FROM watchlists WHERE user_id = ?)").run(userId);
    db.prepare("DELETE FROM watchlists WHERE user_id = ?").run(userId);
    db.close();
  });

  it("GET returns 404 for missing watchlist", async () => {
    const res = await GET(authenticatedRequest(url, {}, { userId }), { params: Promise.resolve({ id: "wl_1" }) });
    expect(res.status).toBe(404);
  });

  it("PATCH requires If-Match", async () => {
    const res = await PATCH(
      new NextRequest(url, { method: "PATCH", body: JSON.stringify({ name: "Updated" }) }),
      { params: Promise.resolve({ id: "wl_1" }) },
    );

    expect(res.status).toBe(400);
  });

  it("PATCH validates the request body", async () => {
    const res = await PATCH(
      new NextRequest(url, {
        method: "PATCH",
        body: JSON.stringify({ status: "invalid" }),
        headers: { "If-Match": "1" },
      }),
      { params: Promise.resolve({ id: "wl_1" }) },
    );

    expect(res.status).toBe(400);
  });

  it("DELETE requires If-Match", async () => {
    const res = await DELETE(new NextRequest(url, { method: "DELETE" }), { params: Promise.resolve({ id: "wl_1" }) });
    expect(res.status).toBe(400);
  });

  it("archives and restores a list", async () => {
    seedList(userId);
    const archived = await PATCH(
      authenticatedRequest(url, {
        method: "PATCH",
        body: JSON.stringify({ status: "ARCHIVED" }),
        headers: { "If-Match": "1" },
      }, { userId }),
      { params: Promise.resolve({ id: "wl_1" }) },
    );
    expect(archived.status).toBe(200);
    expect((await archived.json()).data).toMatchObject({ status: "archived", version: 2 });

    const restored = await PATCH(
      authenticatedRequest(url, {
        method: "PATCH",
        body: JSON.stringify({ status: "ACTIVE" }),
        headers: { "If-Match": "2" },
      }, { userId }),
      { params: Promise.resolve({ id: "wl_1" }) },
    );
    expect(restored.status).toBe(200);
    expect((await restored.json()).data).toMatchObject({ status: "active", version: 3 });
  });

  it("deleting a list removes active items and pauses their conditions", async () => {
    seedList(userId);
    const db = getDatabase();
    db.prepare(`INSERT INTO watchlist_items
      (id,watchlist_id,instrument_id,status,added_at,created_at,updated_at)
      VALUES ('wi-delete','wl_1','AAPL','active',?,?,?)`).run("2026-07-25T00:00:00.000Z", "2026-07-25T00:00:00.000Z", "2026-07-25T00:00:00.000Z");
    db.prepare(`INSERT INTO observation_conditions
      (id,user_id,instrument_id,condition_type,threshold_decimal,status,watchlist_item_id,severity,config_json,created_at,updated_at)
      VALUES ('condition-delete',?,'AAPL','PRICE_BELOW','100','active','wi-delete','attention','{}',?,?)`)
      .run(userId, "2026-07-25T00:00:00.000Z", "2026-07-25T00:00:00.000Z");
    db.close();

    const response = await DELETE(
      authenticatedRequest(url, { method: "DELETE", headers: { "If-Match": "1" } }, { userId }),
      { params: Promise.resolve({ id: "wl_1" }) },
    );
    expect(response.status).toBe(204);

    const verifyDb = getDatabase();
    expect(verifyDb.prepare("SELECT status FROM watchlist_items WHERE id='wi-delete'").get()).toEqual({ status: "removed" });
    expect(verifyDb.prepare("SELECT status FROM observation_conditions WHERE id='condition-delete'").get()).toEqual({ status: "paused" });
    verifyDb.close();
  });
});

function seedList(userId: string): void {
  const db = getDatabase();
  db.prepare(`INSERT INTO watchlists
    (id,user_id,name,status,created_at,updated_at,row_version)
    VALUES ('wl_1',?,'持仓观测','active',?,?,1)`)
    .run(userId, "2026-07-25T00:00:00.000Z", "2026-07-25T00:00:00.000Z");
  db.close();
}
