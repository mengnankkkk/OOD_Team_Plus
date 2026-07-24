import { describe, expect, it } from "vitest";

import { dataQueryInsertSchema } from "./data-queries";

const baseQuery = {
  id: "dq_01",
  userId: "user_01",
  agentRunId: "run_01",
  questionText: "show me the latest result",
  requestedDatasetsJson: "[\"trades\"]",
  outputMode: "sql_only",
  requestedLimit: 100,
  status: "queued",
  isTruncated: false,
  createdAt: "2026-07-24T00:00:00Z",
};

describe("DataQueryInsert validation", () => {
  it("rejects succeeded status without planJson", () => {
    const result = dataQueryInsertSchema.safeParse({
      ...baseQuery,
      status: "succeeded",
      redactedSql: "select 1",
      columnMetadataJson: "[]",
      rowCount: 1,
      completedAt: "2026-07-24T00:01:00Z",
    });

    expect(result.success).toBe(false);
  });

  it("rejects failed status without failureCode", () => {
    const result = dataQueryInsertSchema.safeParse({
      ...baseQuery,
      status: "failed",
      failureMessage: "boom",
      completedAt: "2026-07-24T00:01:00Z",
    });

    expect(result.success).toBe(false);
  });

  it("accepts valid queued status", () => {
    const result = dataQueryInsertSchema.safeParse(baseQuery);

    expect(result.success).toBe(true);
  });

  it("rejects requestedLimit outside bounds", () => {
    const result = dataQueryInsertSchema.safeParse({
      ...baseQuery,
      requestedLimit: 0,
    });

    expect(result.success).toBe(false);
  });

  it("rejects questionText that is too long", () => {
    const result = dataQueryInsertSchema.safeParse({
      ...baseQuery,
      questionText: "x".repeat(2001),
    });

    expect(result.success).toBe(false);
  });
});
