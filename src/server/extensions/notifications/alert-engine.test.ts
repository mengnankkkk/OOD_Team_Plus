import { describe, expect, it } from "vitest";

import { evaluateWatchConditions } from "./alert-engine";

describe("evaluateWatchConditions", () => {
  it("exposes the expected function signature", () => {
    expect(evaluateWatchConditions).toHaveLength(2);
  });

  it("resolves without doing any work yet", async () => {
    await expect(evaluateWatchConditions(["condition_1"], "threshold-crossed")).resolves.toBeUndefined();
  });
});
