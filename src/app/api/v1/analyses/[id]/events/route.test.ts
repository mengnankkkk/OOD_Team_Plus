import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/v1/analyses/[id]/events", () => {
  it("returns an SSE response", async () => {
    const req = new NextRequest("http://localhost/api/v1/analyses/analysis_1/events", {
      headers: { "Last-Event-ID": "event_1" },
    });

    const res = await GET(req, { params: { id: "analysis_1" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });
});
