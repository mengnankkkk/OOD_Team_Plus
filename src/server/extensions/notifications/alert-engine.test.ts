import { describe, expect, it } from "vitest";

import { evaluateWatchConditions } from "./alert-engine";

describe("evaluateWatchConditions", () => {
  it("accepts an optional user scope", () => {
    expect(evaluateWatchConditions).toHaveLength(3);
  });

  it("resolves when no matching conditions exist", async () => {
    await expect(evaluateWatchConditions(["condition_1"], "threshold-crossed")).resolves.toBeUndefined();
  });
});
