import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/v1/portfolio-analysis/trends", () => {
  it("returns all mock trends with the safety metadata", async () => {
    const response = await GET(new NextRequest("http://localhost/api/v1/portfolio-analysis/trends?snapshotId=snap_123"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.trends).toHaveLength(4);
    expect(body.data.trends.every((trend: { source: string; modelVersion: string }) => trend.source === "MOCK")).toBe(true);
    expect(body.meta.source).toBe("MOCK");
    expect(body.meta.modelVersion).toBe("mock-trend-v1");
    expect(body.meta.warning).toContain("Do not use for financial decisions");
  });

  it("uses the default snapshot id when omitted", async () => {
    const response = await GET(new NextRequest("http://localhost/api/v1/portfolio-analysis/trends"));
    const body = await response.json();

    expect(body.data.trends[0].points).toHaveLength(30);
  });
});
