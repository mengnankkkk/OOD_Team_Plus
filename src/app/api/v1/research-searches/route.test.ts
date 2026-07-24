import { describe, expect, it } from "vitest";

import { authenticatedRequest } from "@tests/helpers/auth";
import { POST } from "./route";

describe("POST /api/v1/research-searches", () => {
  it("returns 202 for valid requests", async () => {
    const req = authenticatedRequest("http://localhost/api/v1/research-searches", {
      method: "POST",
      body: JSON.stringify({ query: "test" }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "key1" },
    });

    const res = await POST(req);
    expect(res.status).toBe(202);

    const data = await res.json();
    expect(data.data.analysis.type).toBe("RESEARCH_SEARCH");
    expect(["COMPLETED", "FAILED"]).toContain(data.data.analysis.status);
    expect(Array.isArray(data.data.sourceStatuses)).toBe(true);
  });
});
