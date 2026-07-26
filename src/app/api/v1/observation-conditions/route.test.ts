import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/http/context";
import { authenticatedRequest, seedAuthenticatedUser } from "@tests/helpers/auth";

import { GET, POST } from "./route";

describe("/api/v1/observation-conditions", () => {
  const userId = "condition-route-user";
  const now = "2026-07-25T00:00:00.000Z";

  beforeEach(() => {
    seedAuthenticatedUser({ userId });
    const db = getDatabase();
    db.prepare("DELETE FROM observation_conditions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM watchlist_items WHERE id IN ('condition-item-a','condition-item-b')").run();
    db.prepare("DELETE FROM watchlists WHERE id = 'condition-list'").run();
    db.prepare(`INSERT INTO watchlists
      (id,user_id,name,status,created_at,updated_at)
      VALUES ('condition-list',?,'规则列表','active',?,?)`).run(userId, now, now);
    db.prepare(`INSERT INTO watchlist_items
      (id,watchlist_id,instrument_id,status,added_at,created_at,updated_at)
      VALUES
      ('condition-item-a','condition-list','AAPL','active',?,?,?),
      ('condition-item-b','condition-list','MSFT','active',?,?,?)`).run(now, now, now, now, now, now);
    db.close();
  });

  it("creates a drawdown rule with a normalized window and severity", async () => {
    const response = await POST(authenticatedRequest(
      "http://localhost/api/v1/observation-conditions",
      {
        method: "POST",
        body: JSON.stringify({
          watchlistItemId: "condition-item-a",
          conditionType: "DRAWDOWN_REACH",
          threshold: "0.12",
          windowDays: 30,
          severity: "IMPORTANT",
        }),
        headers: { "Idempotency-Key": "condition-create-drawdown" },
      },
      { userId },
    ));

    expect(response.status).toBe(201);
    expect((await response.json()).data).toMatchObject({
      watchlistItemId: "condition-item-a",
      conditionType: "DRAWDOWN_REACH",
      threshold: "0.12",
      windowDays: 30,
      severity: "IMPORTANT",
      status: "ACTIVE",
      version: 1,
    });
  });

  it("atomically replays concurrent creates with the same idempotency key", async () => {
    const requestBody = JSON.stringify({
      watchlistItemId: "condition-item-a",
      conditionType: "PRICE_ABOVE",
      threshold: "220",
      severity: "IMPORTANT",
    });
    const requests = [
      authenticatedRequest(
        "http://localhost/api/v1/observation-conditions",
        {
          method: "POST",
          body: requestBody,
          headers: { "Idempotency-Key": "condition-concurrent-create" },
        },
        { userId },
      ),
      authenticatedRequest(
        "http://localhost/api/v1/observation-conditions",
        {
          method: "POST",
          body: requestBody,
          headers: { "Idempotency-Key": "condition-concurrent-create" },
        },
        { userId },
      ),
    ];

    const responses = await Promise.all(requests.map((request) => POST(request)));
    const bodies = await Promise.all(responses.map((response) => response.json()));

    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(bodies[0].data.id).toBe(bodies[1].data.id);
    const db = getDatabase();
    expect((db.prepare(`SELECT COUNT(*) AS count FROM observation_conditions
      WHERE user_id=? AND watchlist_item_id='condition-item-a' AND condition_type='PRICE_ABOVE'`)
      .get(userId) as { count: number }).count).toBe(1);
    db.close();
  });

  it("creates review-date rules with threshold_decimal fixed to zero", async () => {
    const response = await POST(authenticatedRequest(
      "http://localhost/api/v1/observation-conditions",
      {
        method: "POST",
        body: JSON.stringify({
          watchlistItemId: "condition-item-a",
          conditionType: "REVIEW_DATE",
          thresholdDate: "2026-08-15",
          severity: "ATTENTION",
        }),
        headers: { "Idempotency-Key": "condition-create-review" },
      },
      { userId },
    ));
    expect(response.status).toBe(201);
    expect((await response.json()).data).toMatchObject({
      threshold: "0",
      thresholdDate: "2026-08-15",
    });
  });

  it("filters by watchlist item and status", async () => {
    const db = getDatabase();
    for (const [id, itemId, status] of [
      ["condition-a-active", "condition-item-a", "active"],
      ["condition-a-paused", "condition-item-a", "paused"],
      ["condition-b-active", "condition-item-b", "active"],
    ]) {
      db.prepare(`INSERT INTO observation_conditions
        (id,user_id,instrument_id,condition_type,threshold_decimal,status,watchlist_item_id,severity,config_json,created_at,updated_at)
        VALUES (?,?,'AAPL','PRICE_ABOVE','200',?,?, 'attention','{}',?,?)`)
        .run(id, userId, status, itemId, now, now);
    }
    db.close();

    const response = await GET(authenticatedRequest(
      "http://localhost/api/v1/observation-conditions?watchlistItemId=condition-item-a&status=active",
      {},
      { userId },
    ));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({ id: "condition-a-active", status: "ACTIVE" });
  });

  it("rejects meaningless windows on non-drawdown rules", async () => {
    const response = await POST(authenticatedRequest(
      "http://localhost/api/v1/observation-conditions",
      {
        method: "POST",
        body: JSON.stringify({
          watchlistItemId: "condition-item-a",
          conditionType: "PRICE_BELOW",
          threshold: "150",
          windowDays: 20,
          severity: "ATTENTION",
        }),
        headers: { "Idempotency-Key": "condition-invalid-window" },
      },
      { userId },
    ));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("OBSERVATION_CONDITION_INVALID");
  });
});
