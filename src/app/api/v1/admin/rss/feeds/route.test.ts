import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { POST } from "./route";

describe("POST /api/v1/admin/rss/feeds", () => {
  it("blocks SSRF URLs", async () => {
    const req = new NextRequest("http://localhost/api/v1/admin/rss/feeds", {
      method: "POST",
      body: JSON.stringify({ url: "http://127.0.0.1/feed" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
