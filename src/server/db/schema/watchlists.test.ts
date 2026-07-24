import { describe, expect, it } from "vitest";

import { portfolioScoreSnapshotInsertSchema, rssItemInsertSchema, watchlistItemInsertSchema } from "./watchlists";

describe("WatchlistItemInsert", () => {
  it("rejects empty instrument_id", () => {
    const result = watchlistItemInsertSchema.safeParse({
      id: "wi_1",
      watchlistId: "wl_1",
      instrumentId: "",
      status: "active",
      addedAt: "2026-07-24T00:00:00Z",
      createdAt: "2026-07-24T00:00:00Z",
      updatedAt: "2026-07-24T00:00:00Z",
    });

    expect(result.success).toBe(false);
  });
});

describe("RssItemInsert", () => {
  it("rejects summary over 5000 chars", () => {
    const result = rssItemInsertSchema.safeParse({
      id: "ri_1",
      feedId: "feed_1",
      guid: "guid-1",
      title: "RSS item",
      summary: "a".repeat(5001),
      createdAt: "2026-07-24T00:00:00Z",
    });

    expect(result.success).toBe(false);
  });
});

describe("PortfolioScoreSnapshotInsert", () => {
  it("rejects health_score above 100", () => {
    const result = portfolioScoreSnapshotInsertSchema.safeParse({
      id: "ps_1",
      portfolioSnapshotId: "port_1",
      healthScore: 101,
      riskScore: 50,
      scoreVersion: "portfolio-score-v1",
      componentsJson: "{}",
      computedAt: "2026-07-24T00:00:00Z",
      createdAt: "2026-07-24T00:00:00Z",
    });

    expect(result.success).toBe(false);
  });

  it("accepts valid score", () => {
    const result = portfolioScoreSnapshotInsertSchema.safeParse({
      id: "ps_1",
      portfolioSnapshotId: "port_1",
      healthScore: 88,
      riskScore: 21,
      scoreVersion: "portfolio-score-v1",
      componentsJson: "{}",
      computedAt: "2026-07-24T00:00:00Z",
      createdAt: "2026-07-24T00:00:00Z",
    });

    expect(result.success).toBe(true);
  });
});
