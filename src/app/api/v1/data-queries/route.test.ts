import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("better-sqlite3", () => ({ default: vi.fn() }));

import { GET, POST } from "./route";

describe("POST /api/v1/data-queries", () => {
  it("returns 400 when Idempotency-Key is missing", async () => {
    const req = new NextRequest("http://localhost/api/v1/data-queries", {
      method: "POST",
      body: JSON.stringify({
        questionText: "show my portfolio",
        requestedDatasets: ["portfolio_snapshots"],
        outputMode: "SQL_ONLY",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid outputMode", async () => {
    const req = new NextRequest("http://localhost/api/v1/data-queries", {
      method: "POST",
      body: JSON.stringify({
        questionText: "q",
        requestedDatasets: ["d"],
        outputMode: "INVALID",
      }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "key1" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 202 with analysisId for valid request", async () => {
    const req = new NextRequest("http://localhost/api/v1/data-queries", {
      method: "POST",
      body: JSON.stringify({
        questionText: "show my portfolio",
        requestedDatasets: ["portfolio_snapshots"],
        outputMode: "SQL_ONLY",
      }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "key1" },
    });

    const res = await POST(req);
    expect(res.status).toBe(202);

    const data = await res.json();
    expect(data.data.analysis.type).toBe("DATA_QUERY");
    expect(data.data.analysis.status).toBe("QUEUED");
    expect(data.data.analysis.streamUrl).toContain("/api/v1/analyses/");
  });

  it("GET returns empty list", async () => {
    const req = new NextRequest("http://localhost/api/v1/data-queries");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.data.items)).toBe(true);
    expect(data.meta.pagination.limit).toBe(20);
  });
});
