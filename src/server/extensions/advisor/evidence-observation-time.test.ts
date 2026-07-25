import { describe, expect, it } from "vitest";

import { observedAtForFinding } from "./evidence-observation-time";

describe("observedAtForFinding", () => {
  it("assigns an honest observation time to every persisted finding", () => {
    const context = {
      generatedAt: "2026-07-25T10:00:05.000Z",
      marketDataAsOf: "2026-07-25T09:59:00.000Z",
      portfolioSnapshotAsOf: "2026-07-25T09:55:00.000Z",
      profileAsOf: "2026-07-25T09:50:00.000Z",
    };

    expect(observedAtForFinding({ agent: "DATA_RESEARCH", stance: "support", ...context }))
      .toBe("2026-07-25T09:59:00.000Z");
    expect(observedAtForFinding({ agent: "PORTFOLIO_RISK", stance: "support", ...context }))
      .toBe("2026-07-25T09:55:00.000Z");
    expect(observedAtForFinding({ agent: "PROFILE_CONTEXT", stance: "support", ...context }))
      .toBe("2026-07-25T09:50:00.000Z");
    expect(observedAtForFinding({ agent: "DATA_RESEARCH", stance: "missing", ...context }))
      .toBe("2026-07-25T10:00:05.000Z");
    expect(observedAtForFinding({ agent: "RECOMMENDATION", stance: "counter", ...context }))
      .toBe("2026-07-25T10:00:05.000Z");
  });
});
