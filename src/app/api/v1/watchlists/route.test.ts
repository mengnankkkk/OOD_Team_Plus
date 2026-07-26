import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/http/context";
import { authenticatedRequest, seedAuthenticatedUser } from "@tests/helpers/auth";
import { GET, POST } from "./route";

describe("/api/v1/watchlists", () => {
  const userId = "watchlist-route-user";

  beforeEach(() => {
    seedAuthenticatedUser({ userId });
    const db = getDatabase();
    db.prepare("DELETE FROM watchlist_items WHERE watchlist_id IN (SELECT id FROM watchlists WHERE user_id = ?)").run(userId);
    db.prepare("DELETE FROM watchlists WHERE user_id = ?").run(userId);
    db.close();
  });

  it("POST returns 400 for invalid body", async () => {
    const res = await POST(authenticatedRequest("http://localhost/api/v1/watchlists", { method: "POST", body: "{}" }, { userId }));
    expect(res.status).toBe(400);
  });

  it("POST returns 201 for a valid body", async () => {
    const request = () => authenticatedRequest("http://localhost/api/v1/watchlists", {
        method: "POST",
        body: JSON.stringify({ name: "My list", description: "Tracking" }),
        headers: { "Idempotency-Key": "watchlist-key-1" },
      }, { userId });
    const res = await POST(request());
    const replay = await POST(request());

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.name).toBe("My list");
    expect(body.data.status).toBe("active");
    expect(replay.status).toBe(201);
    expect((await replay.json()).data.id).toBe(body.data.id);
  });

  it("returns 409 when an idempotency key is reused with another request", async () => {
    const first = await POST(authenticatedRequest("http://localhost/api/v1/watchlists", {
      method: "POST",
      body: JSON.stringify({ name: "First list" }),
      headers: { "Idempotency-Key": "watchlist-conflict-key" },
    }, { userId }));
    const conflict = await POST(authenticatedRequest("http://localhost/api/v1/watchlists", {
      method: "POST",
      body: JSON.stringify({ name: "Another list" }),
      headers: { "Idempotency-Key": "watchlist-conflict-key" },
    }, { userId }));

    expect(first.status).toBe(201);
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("GET returns an empty list and bounded pagination", async () => {
    const res = await GET(authenticatedRequest("http://localhost/api/v1/watchlists?limit=999", {}, { userId }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.data.items)).toBe(true);
    expect(body.meta.pagination.limit).toBe(100);
  });

  it("GET filters archived lists", async () => {
    const db = getDatabase();
    db.prepare(`INSERT INTO watchlists
      (id,user_id,name,status,created_at,updated_at) VALUES
      ('wl-active',?,'活动列表','active','2026-07-25T00:00:00.000Z','2026-07-25T00:00:00.000Z'),
      ('wl-archived',?,'归档列表','archived','2026-07-25T00:00:00.000Z','2026-07-25T00:00:00.000Z')`)
      .run(userId, userId);
    db.close();

    const res = await GET(authenticatedRequest(
      "http://localhost/api/v1/watchlists?status=archived",
      {},
      { userId },
    ));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({ id: "wl-archived", status: "archived" });
  });
});
