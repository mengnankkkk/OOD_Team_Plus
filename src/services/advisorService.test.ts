import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/frontend-migration/api", () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
}));

import { apiGet } from "@/features/frontend-migration/api";
import { listOnboardingMessages, normalizeDebateSuggestion } from "./advisorService";

describe("normalizeDebateSuggestion", () => {
  it("preserves the trusted nullable target symbol for recommended suggestions", () => {
    expect(normalizeDebateSuggestion({
      recommended: true,
      motion: "未来 1-3 个月是否应继续持有该标的",
      reason: "多空证据存在真实分歧。",
      targetSymbol: "510300.OF",
    })).toEqual({
      recommended: true,
      motion: "未来 1-3 个月是否应继续持有该标的",
      reason: "多空证据存在真实分歧。",
      targetSymbol: "510300.OF",
    });

    expect(normalizeDebateSuggestion({
      recommended: true,
      motion: "当前市场观点是否成立",
      reason: "这是一个不依赖单一标的的市场问题。",
      targetSymbol: null,
    })).toMatchObject({ targetSymbol: null });
  });
});

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
