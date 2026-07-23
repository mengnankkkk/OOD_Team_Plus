import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import { getDelegationView } from "@/features/chat/lib/delegation-state";

function part(type: string, state: string) {
  return { type, state } as unknown as UIMessage["parts"][number];
}

describe("getDelegationView", () => {
  it("maps a running Mastra sub-agent tool", () => {
    expect(getDelegationView(part("tool-agent-explorer", "input-available"))).toEqual({
      key: "explorer",
      label: "Explorer",
      status: "running",
    });
  });

  it("maps completed and failed states without exposing payloads", () => {
    expect(getDelegationView(part("tool-agent-reviewer", "output-available"))?.status).toBe(
      "complete",
    );
    expect(getDelegationView(part("tool-agent-reviewer", "output-error"))?.status).toBe(
      "failed",
    );
  });

  it("maps Mastra data agent completion events", () => {
    expect(
      getDelegationView({
        type: "data-tool-agent",
        data: { id: "explorer-agent", status: "finished" },
      } as never),
    ).toEqual({ key: "explorer", label: "Explorer", status: "complete" });
  });

  it("ignores ordinary tools", () => {
    expect(getDelegationView(part("tool-search", "output-available"))).toBeNull();
  });
});
