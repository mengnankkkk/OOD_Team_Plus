import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { DELETE, GET, PATCH } from "./route";

const url = "http://localhost/api/v1/watchlists/wl_1";

describe("/api/v1/watchlists/[id]", () => {
  it("GET returns 404 for missing watchlist", async () => {
    const res = await GET(new NextRequest(url), { params: Promise.resolve({ id: "wl_1" }) });
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
});
