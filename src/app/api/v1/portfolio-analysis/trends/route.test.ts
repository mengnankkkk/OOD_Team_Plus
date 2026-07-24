import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/v1/portfolio-analysis/trends", () => {
  it("returns snapshot-backed trends with provenance metadata", async () => {
    const response = await GET(new NextRequest("http://localhost/api/v1/portfolio-analysis/trends?snapshotId=portfolio-snapshot-demo"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.trends).toHaveLength(4);
    expect(body.data.source).toMatch(/^LOCAL_/u);
    expect(body.meta.source).toMatch(/^LOCAL_/u);
    expect(body.meta.modelVersion).toBe("portfolio-trend-v2");
  });

  it("uses the default snapshot id when omitted", async () => {
    const response = await GET(new NextRequest("http://localhost/api/v1/portfolio-analysis/trends"));
    const body = await response.json();

    expect(body.data.trends[0].points.length).toBeGreaterThanOrEqual(2);
  });
});
