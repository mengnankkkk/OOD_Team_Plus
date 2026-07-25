import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/frontend-migration/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

import { apiGet } from "@/features/frontend-migration/api";
import { listDecisionLogs } from "./alertsService";

describe("listDecisionLogs", () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
  });

  it("normalizes legacy backend actions and preserves recommendation links", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      items: [{
        id: "decision-1",
        recommendationId: "recommendation-1",
        analysisId: "analysis-1",
        action: "ACCEPT",
        reason: "先做模拟",
        recommendation: { id: "recommendation-1", summary: "降低集中度" },
        createdAt: "2026-07-25T08:00:00.000Z",
      }],
    });

    const result = await listDecisionLogs("user-1");

    expect(result[0]).toMatchObject({
      recommendationId: "recommendation-1",
      analysisId: "analysis-1",
      action: "simulated",
      reason: "先做模拟",
    });
  });
});
