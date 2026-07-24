import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/v1/health", () => {
  it("returns a sanitized readiness state", async () => {
    const response = await GET();
    const body = await response.json();
    expect([200, 503]).toContain(response.status);
    expect(["READY", "DEGRADED", "NOT_READY"]).toContain(body.data.status);
    expect(body.data.checks).toEqual(expect.arrayContaining([expect.objectContaining({ name: "sqlite" })]));
    expect(JSON.stringify(body)).not.toMatch(/API_KEY|PASSWORD|DB_PATH|user\.json/iu);
  });
});
