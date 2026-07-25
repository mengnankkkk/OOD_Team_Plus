import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/http/context";
import { authenticatedRequest, seedAuthenticatedUser } from "@tests/helpers/auth";
import { DELETE, PATCH } from "../../../watchlist-items/[id]/route";
import { GET, POST } from "./route";

const collectionUrl = "http://localhost/api/v1/watchlists/w1/items";
const itemUrl = "http://localhost/api/v1/watchlist-items/i1";
const context = { params: Promise.resolve({ id: "w1" }) };

describe("watchlist item routes", () => {
  const userId = "watchlist-item-route-user";

  beforeEach(() => {
    seedAuthenticatedUser({ userId });
    const db = getDatabase();
    db.prepare("DELETE FROM observation_conditions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM watchlist_items WHERE watchlist_id = 'w1'").run();
    db.prepare("DELETE FROM watchlists WHERE id = 'w1' OR user_id = ?").run(userId);
    db.prepare("DELETE FROM goals WHERE id = 'goal-route' OR user_id = ?").run(userId);
    db.prepare(`INSERT INTO watchlists
      (id,user_id,name,status,created_at,updated_at) VALUES ('w1',?,'持仓观测','active',?,?)`)
      .run(userId, "2026-07-25T00:00:00.000Z", "2026-07-25T00:00:00.000Z");
    db.prepare(`INSERT INTO goals
      (id,user_id,name,target_amount_decimal,horizon,priority,status,created_at,updated_at)
      VALUES ('goal-route',?,'长期目标','1000000','LONG','HIGH','active',?,?)`)
      .run(userId, "2026-07-25T00:00:00.000Z", "2026-07-25T00:00:00.000Z");
    db.close();
  });

  it("POST returns 400 for an invalid item", async () => {
    const req = authenticatedRequest(collectionUrl, { method: "POST", body: "{}" }, { userId });
    expect((await POST(req, context)).status).toBe(400);
  });

  it("POST returns 404 for a valid item when watchlist is absent", async () => {
    const req = authenticatedRequest("http://localhost/api/v1/watchlists/missing/items", {
      method: "POST",
      body: JSON.stringify({ instrumentId: "AAPL", reason: "Review earnings" }),
      headers: { "Idempotency-Key": "item-key-1" },
    }, { userId });
    expect((await POST(req, { params: Promise.resolve({ id: "missing" }) })).status).toBe(404);
  });

  it("GET enforces watchlist ownership", async () => {
    const response = await GET(authenticatedRequest(
      "http://localhost/api/v1/watchlists/missing/items",
      {},
      { userId },
    ), { params: Promise.resolve({ id: "missing" }) });
    expect(response.status).toBe(404);
  });

  it("PATCH returns 400 without If-Match", async () => {
    expect((await PATCH(new NextRequest(itemUrl, { method: "PATCH" }), context)).status).toBe(400);
  });

  it("DELETE returns 400 without If-Match", async () => {
    expect((await DELETE(new NextRequest(itemUrl, { method: "DELETE" }), context)).status).toBe(400);
  });

  it("persists goal metadata and returns an existing-item conflict", async () => {
    const first = await POST(
      authenticatedRequest(collectionUrl, {
        method: "POST",
        body: JSON.stringify({
          instrumentId: "AAPL",
          reason: "长期观察",
          plannedHorizon: "3-5 年",
          goalId: "goal-route",
          source: "USER",
          initialDrawdownThresholdPct: 15,
        }),
        headers: { "Idempotency-Key": "item-create-1" },
      }, { userId }),
      context,
    );
    expect(first.status).toBe(201);
    expect((await first.json()).data).toMatchObject({
      goalId: "goal-route",
      plannedHorizon: "3-5 年",
      activeConditionCount: 1,
    });

    const duplicate = await POST(
      authenticatedRequest(collectionUrl, {
        method: "POST",
        body: JSON.stringify({ instrumentId: "AAPL", source: "USER" }),
        headers: { "Idempotency-Key": "item-create-2" },
      }, { userId }),
      context,
    );
    const duplicateBody = await duplicate.json();
    expect(duplicate.status).toBe(409);
    expect(duplicateBody.error).toMatchObject({
      code: "WATCHLIST_ITEM_EXISTS",
      details: { watchlistId: "w1", instrumentId: "AAPL" },
    });
  });

  it("edits reason, free-text horizon, and goal", async () => {
    const created = await POST(
      authenticatedRequest(collectionUrl, {
        method: "POST",
        body: JSON.stringify({ instrumentId: "MSFT", source: "USER" }),
        headers: { "Idempotency-Key": "item-edit-create" },
      }, { userId }),
      context,
    );
    const item = (await created.json()).data as { id: string; version: number };

    const response = await PATCH(
      authenticatedRequest(`http://localhost/api/v1/watchlist-items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ reason: "等待估值", plannedHorizon: "18-24 个月", goalId: "goal-route" }),
        headers: { "If-Match": String(item.version) },
      }, { userId }),
      { params: Promise.resolve({ id: item.id }) },
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      reason: "等待估值",
      plannedHorizon: "18-24 个月",
      goalId: "goal-route",
    });
  });
});
