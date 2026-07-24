import { describe, expect, it } from "vitest";

import { SSE_EVENT_TYPES } from "./event-persister";

describe("SSE_EVENT_TYPES", () => {
  it("has the expected values", () => {
    expect(SSE_EVENT_TYPES).toEqual([
      "query.planned",
      "query.validated",
      "query.completed",
      "artifact.completed",
      "branch.options.created",
      "branch.created",
      "search.source.completed",
      "portfolio.refreshed",
      "rss.synced",
      "agent.started",
      "agent.delegated",
      "agent.completed",
      "agent.failed",
      "tool.started",
      "tool.completed",
      "tool.failed",
      "evidence.added",
      "compliance.completed",
      "recommendation.created",
    ]);
  });
});
