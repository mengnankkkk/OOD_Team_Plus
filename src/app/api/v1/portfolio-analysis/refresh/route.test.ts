import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("better-sqlite3", () => ({ default: vi.fn() }));

import { POST } from "./route";

const url = "http://localhost/api/v1/portfolio-analysis/refresh";

describe("POST /api/v1/portfolio-analysis/refresh", () => {
  it("returns 400 when Idempotency-Key is missing", async () => {
    const req = new NextRequest(url, {
      method: "POST",
      body: JSON.stringify({ portfolioId: "p1" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error.code).toBe("INVALID_REQUEST");
  });

  it("returns 400 when portfolioId is missing", async () => {
    const req = new NextRequest(url, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "key1" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 202 with analysis for a valid request", async () => {
    const req = new NextRequest(url, {
      method: "POST",
      body: JSON.stringify({ portfolioId: "p1" }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "key1" },
    });

    const res = await POST(req);
    expect(res.status).toBe(202);

    const data = await res.json();
    expect(data.data.analysis.type).toBe("PORTFOLIO_REFRESH");
    expect(data.data.analysis.status).toBe("QUEUED");
  });
});
