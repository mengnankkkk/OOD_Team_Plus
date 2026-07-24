import { describe, expect, it } from "vitest";

import { chatRequestSchema } from "@/server/chat/contract";
import { holdingConfirmSchema } from "@/server/advisor/contracts";

const identity = {
  thread: "559b0c4f-e579-4eff-8a78-7ed951e030a8",
  resource: "2fe12ebd-c6fe-4211-95b0-84b718f05ec5",
};

function requestWith(text: string) {
  return {
    message: {
      id: "d864c92b-6aa0-4dc2-81f4-b3d90f3e13d8",
      role: "user",
      parts: [{ type: "text", text }],
    },
    memory: identity,
  };
}

describe("chatRequestSchema", () => {
  it("accepts one valid user message", () => {
    expect(chatRequestSchema.parse(requestWith("你好"))).toBeTruthy();
  });

  it.each(["", "   "])("rejects blank input", (text) => {
    expect(chatRequestSchema.safeParse(requestWith(text)).success).toBe(false);
  });

  it("rejects oversized input", () => {
    expect(chatRequestSchema.safeParse(requestWith("x".repeat(4_001))).success).toBe(
      false,
    );
  });

  it("rejects invalid session identifiers", () => {
    const request = requestWith("hello");
    request.memory.thread = "not-a-uuid";
    expect(chatRequestSchema.safeParse(request).success).toBe(false);
  });
});

describe("advisor holding confirmation contract", () => {
  it("accepts a null instrument id so index drafts reach business validation", () => {
    expect(holdingConfirmSchema.safeParse({
      confirmedCandidates: [{
        candidateId: "candidate_01",
        instrumentId: null,
        assetType: null,
        symbol: null,
        quantity: "100",
        averageCost: "4000",
        market: "CN",
        currency: "CNY",
      }],
    }).success).toBe(true);
  });
});
