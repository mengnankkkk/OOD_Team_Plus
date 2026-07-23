import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { GET, POST } from "./route";

describe("/api/v1/watchlists", () => {
  it("POST returns 400 for invalid body", async () => {
    const res = await POST(new NextRequest("http://localhost/api/v1/watchlists", { method: "POST", body: "{}" }));
    expect(res.status).toBe(400);
  });

  it("POST returns 201 for a valid body", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/v1/watchlists", {
        method: "POST",
        body: JSON.stringify({ name: "My list", description: "Tracking" }),
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.name).toBe("My list");
    expect(body.data.status).toBe("active");
  });

  it("GET returns an empty list and bounded pagination", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/watchlists?limit=999"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.items).toEqual([]);
    expect(body.meta.pagination.limit).toBe(100);
  });
});
