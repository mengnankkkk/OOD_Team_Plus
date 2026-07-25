import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/http/context";
import { authenticatedRequest, seedAuthenticatedUser } from "@tests/helpers/auth";

import { POST } from "./route";

describe("/api/v1/watchlists/[id]/check", () => {
  const userId = "watchlist-check-route-user";
  const now = "2026-07-25T00:00:00.000Z";

  beforeEach(() => {
    seedAuthenticatedUser({ userId });
    const db = getDatabase();
    db.prepare("DELETE FROM idempotency_records WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM watchlist_items WHERE id='check-route-item'").run();
    db.prepare("DELETE FROM watchlists WHERE id='check-route-list'").run();
    db.prepare(`INSERT INTO watchlists
      (id,user_id,name,status,created_at,updated_at)
      VALUES ('check-route-list',?,'路由检查','active',?,?)`).run(userId, now, now);
    db.prepare(`INSERT INTO watchlist_items
      (id,watchlist_id,instrument_id,status,added_at,created_at,updated_at)
      VALUES ('check-route-item','check-route-list','AAPL','active',?,?,?)`).run(now, now, now);
    db.close();
  });

  it("requires an idempotency key", async () => {
    const response = await POST(
      authenticatedRequest("http://localhost/api/v1/watchlists/check-route-list/check", {
        method: "POST",
        body: JSON.stringify({ forceMarketRefresh: false }),
      }, { userId }),
      { params: Promise.resolve({ id: "check-route-list" }) },
    );
    expect(response.status).toBe(400);
  });

  it("saves and replays a scoped check response", async () => {
    const request = () => authenticatedRequest("http://localhost/api/v1/watchlists/check-route-list/check", {
      method: "POST",
      body: JSON.stringify({ forceMarketRefresh: false }),
      headers: { "Idempotency-Key": "check-route-key" },
    }, { userId });
    const first = await POST(request(), { params: Promise.resolve({ id: "check-route-list" }) });
    const second = await POST(request(), { params: Promise.resolve({ id: "check-route-list" }) });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
  });

  it("rejects a reused key with a different check request", async () => {
    const first = await POST(authenticatedRequest(
      "http://localhost/api/v1/watchlists/check-route-list/check",
      {
        method: "POST",
        body: JSON.stringify({ forceMarketRefresh: false }),
        headers: { "Idempotency-Key": "check-route-conflict" },
      },
      { userId },
    ), { params: Promise.resolve({ id: "check-route-list" }) });
    const conflict = await POST(authenticatedRequest(
      "http://localhost/api/v1/watchlists/check-route-list/check",
      {
        method: "POST",
        body: JSON.stringify({ forceMarketRefresh: true }),
        headers: { "Idempotency-Key": "check-route-conflict" },
      },
      { userId },
    ), { params: Promise.resolve({ id: "check-route-list" }) });

    expect(first.status).toBe(200);
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("executes concurrent identical keys once and replays the same response", async () => {
    const request = () => authenticatedRequest(
      "http://localhost/api/v1/watchlists/check-route-list/check",
      {
        method: "POST",
        body: JSON.stringify({ forceMarketRefresh: false }),
        headers: { "Idempotency-Key": "check-route-concurrent" },
      },
      { userId },
    );
    const [left, right] = await Promise.all([
      POST(request(), { params: Promise.resolve({ id: "check-route-list" }) }),
      POST(request(), { params: Promise.resolve({ id: "check-route-list" }) }),
    ]);

    expect(left.status).toBe(200);
    expect(right.status).toBe(200);
    expect(await right.json()).toEqual(await left.json());
  });

  it("atomically rejects concurrent different requests using the same key", async () => {
    const run = (forceMarketRefresh: boolean) => POST(authenticatedRequest(
      "http://localhost/api/v1/watchlists/check-route-list/check",
      {
        method: "POST",
        body: JSON.stringify({ forceMarketRefresh }),
        headers: { "Idempotency-Key": "check-route-concurrent-conflict" },
      },
      { userId },
    ), { params: Promise.resolve({ id: "check-route-list" }) });
    const responses = await Promise.all([run(false), run(true)]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const conflict = responses.find((response) => response.status === 409)!;
    expect((await conflict.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });
});
