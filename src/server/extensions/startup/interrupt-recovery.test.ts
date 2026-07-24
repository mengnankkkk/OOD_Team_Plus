import { describe, expect, it } from "vitest";

import { recoverInterruptedRuns } from "./interrupt-recovery";

describe("recoverInterruptedRuns", () => {
  it("returns 0 for the stub", async () => {
    await expect(recoverInterruptedRuns()).resolves.toBe(0);
  });
});
