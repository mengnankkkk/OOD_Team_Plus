import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("/api/v1/notifications", () => {
  it("GET returns empty notifications with filters", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/notifications?unreadOnly=true&severity=IMPORTANT&limit=5"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.items).toEqual([]);
    expect(body.data.filters).toEqual({ unreadOnly: true, severity: "IMPORTANT" });
    expect(body.meta.pagination.limit).toBe(5);
  });

  it("GET rejects invalid severity", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/notifications?severity=critical"));
    expect(res.status).toBe(400);
  });
});
