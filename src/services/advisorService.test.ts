import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/frontend-migration/api", () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
}));

import { apiGet } from "@/features/frontend-migration/api";
import { listOnboardingMessages } from "./advisorService";

describe("listOnboardingMessages", () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
  });

  it.each(["GUIDED_INTAKE", "FINANCIAL_PLAN"])("does not load a professional trace for %s messages", async (conversationKind) => {
    vi.mocked(apiGet).mockResolvedValue({
      items: [{
        id: "assistant-1",
        role: "assistant",
        content: "普通理财对话",
        metadata_json: JSON.stringify({ conversationKind }),
        created_at: "2026-07-25T00:00:00.000Z",
        session_id: "conversation-1",
        agent_run_id: "analysis-1",
      }],
    });

    const messages = await listOnboardingMessages("user-1", "conversation-1");

    expect(messages[0]?.metadata.trace).toBeUndefined();
    expect(apiGet).toHaveBeenCalledTimes(1);
  });
});
