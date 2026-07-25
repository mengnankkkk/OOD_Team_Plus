import { afterEach, describe, expect, it, vi } from "vitest";

import { authenticatedRequest } from "@tests/helpers/auth";

import { GET, POST } from "./route";

describe("/api/v1/notifications/sync", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns idle state before the first scan", async () => {
    const userId = "notification-idle-user";
    const response = await GET(authenticatedRequest("http://localhost/api/v1/notifications/sync", {}, { userId, role: "USER" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.status).toBe("idle");
  });

  it("runs a snapshot-backed scan when PandaData is not configured", async () => {
    vi.stubEnv("DEFAULT_USERNAME", "your_value_here");
    vi.stubEnv("DEFAULT_PASSWORD", "your_value_here");
    vi.stubEnv("JAVA_SERVICE_BASE_URL", "your_value_here");
    const response = await POST(authenticatedRequest("http://localhost/api/v1/notifications/sync", {
      method: "POST",
      body: JSON.stringify({ forceMarketRefresh: false }),
    }, { userId: "notification-route-user", role: "USER" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.status).toBe("partial");
    expect(body.data.errorCode).toBe("PANDADATA_NOT_CONFIGURED");
    expect(body.data.createdCount).toBeGreaterThanOrEqual(0);
  });
});
