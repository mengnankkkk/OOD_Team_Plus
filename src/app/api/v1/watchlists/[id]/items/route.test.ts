import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { DELETE, PATCH } from "../../../watchlist-items/[id]/route";
import { GET, POST } from "./route";

const collectionUrl = "http://localhost/api/v1/watchlists/w1/items";
const itemUrl = "http://localhost/api/v1/watchlist-items/i1";
const context = { params: Promise.resolve({ id: "w1" }) };

describe("watchlist item routes", () => {
  it("POST returns 400 for an invalid item", async () => {
    const req = new NextRequest(collectionUrl, { method: "POST", body: "{}" });
    expect((await POST(req, context)).status).toBe(400);
  });

  it("POST returns 404 for a valid item when watchlist is absent", async () => {
    const req = new NextRequest(collectionUrl, {
      method: "POST",
      body: JSON.stringify({ instrumentId: "AAPL", reason: "Review earnings" }),
    });
    expect((await POST(req, context)).status).toBe(404);
  });

  it("GET returns an empty paginated list", async () => {
    const body = await (await GET(new NextRequest(collectionUrl), context)).json();
    expect(body.data.items).toEqual([]);
    expect(body.meta.pagination.limit).toBe(20);
  });

  it("PATCH returns 400 without If-Match", async () => {
    expect((await PATCH(new NextRequest(itemUrl, { method: "PATCH" }), context)).status).toBe(400);
  });

  it("DELETE returns 400 without If-Match", async () => {
    expect((await DELETE(new NextRequest(itemUrl, { method: "DELETE" }), context)).status).toBe(400);
  });
});
