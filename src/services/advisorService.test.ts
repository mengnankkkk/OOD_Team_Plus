import { describe, expect, it } from "vitest";

import { normalizeDebateSuggestion } from "./advisorService";

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
