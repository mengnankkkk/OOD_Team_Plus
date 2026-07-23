import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { GET, POST } from "./route";

const url = "http://localhost/api/v1/generated-artifacts";

describe("POST /api/v1/generated-artifacts", () => {
  it("returns 400 without Idempotency-Key", async () => {
    const req = new NextRequest(url, {
      method: "POST",
      body: JSON.stringify({ artifactType: "MARKDOWN", title: "Summary", sourceMessageId: "msg1" }),
    });

    expect((await POST(req)).status).toBe(400);
  });

  it("returns 400 without sourceMessageId or sourceQueryId", async () => {
    const req = new NextRequest(url, {
      method: "POST",
      body: JSON.stringify({ artifactType: "MARKDOWN", title: "Summary" }),
      headers: { "Idempotency-Key": "key1" },
    });

    expect((await POST(req)).status).toBe(400);
  });

  it("returns 202 for valid request with sourceMessageId", async () => {
    const req = new NextRequest(url, {
      method: "POST",
      body: JSON.stringify({ artifactType: "MARKDOWN", title: "Summary", sourceMessageId: "msg1" }),
      headers: { "Idempotency-Key": "key1" },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.data.analysis.type).toBe("ARTIFACT_GENERATION");
    expect(body.data.analysis.status).toBe("QUEUED");
  });
});

describe("GET /api/v1/generated-artifacts", () => {
  it("returns an empty paginated list", async () => {
    const res = await GET(new NextRequest(`${url}?limit=10`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.items).toEqual([]);
    expect(body.meta.pagination).toEqual({ limit: 10, nextCursor: null, hasMore: false });
  });
});
