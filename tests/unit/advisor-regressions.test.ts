import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  streamOptions: [] as Array<Record<string, unknown>>,
  malformedRole: null as string | null,
}));

vi.mock("@mastra/core/agent", () => ({
  Agent: class Agent {
    async stream(prompt: string, options: Record<string, unknown>) {
      harness.streamOptions.push(options);
      const role = prompt.match(/当前角色：(\w+)/u)?.[1];
      const object = role
        ? role === harness.malformedRole ? undefined : finding(role)
        : decision();
      return {
        textStream: emptyStream<string>(),
        objectStream: emptyStream<Record<string, unknown>>(),
        object: Promise.resolve(object),
      };
    }
  },
}));

vi.mock("@/features/frontend-migration/api", () => ({
  FrontendApiError: class FrontendApiError extends Error {
    constructor(public status: number) {
      super(`HTTP ${status}`);
    }
  },
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
}));

import { apiGet, apiPost } from "@/features/frontend-migration/api";
import { runChiefAdvisor } from "@/mastra/agents/chief-advisor";
import { enforcePublicationStatus } from "@/server/extensions/advisor/professional";
import { sendAdvisorMessageStream } from "@/services/advisorService";

describe("advisor regressions", () => {
  beforeEach(() => {
    harness.streamOptions.length = 0;
    harness.malformedRole = null;
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiPost).mockReset();
  });

  it("creates a draft conversation without probing a fake server id", async () => {
    vi.mocked(apiPost)
      .mockResolvedValueOnce({ id: "conversation_created" })
      .mockResolvedValueOnce({ answer: "收到", analysis: {} });

    const result = await sendAdvisorMessageStream("新会话", null, "SQL_ONLY");

    expect(apiGet).not.toHaveBeenCalled();
    expect(apiPost).toHaveBeenNthCalledWith(1, "/api/v1/conversations", { title: "新会话" });
    expect(result.sessionId).toBe("conversation_created");
  });

  it("uses compatible JSON prompting and isolates malformed specialist output", async () => {
    harness.malformedRole = "PORTFOLIO_RISK";
    const fallback = finding("PORTFOLIO_RISK", "服务端组合风险结论");
    const result = await runChiefAdvisor({
      prompt: "测试",
      requiredAgents: ["PROFILE_CONTEXT", "PORTFOLIO_RISK"],
      fallbackFindings: [finding("PROFILE_CONTEXT"), fallback],
    } as never);

    expect(result.findings).toContainEqual(fallback);
    expect(result.decision.summary).toBe("模型决策完成");
    for (const options of harness.streamOptions) {
      expect(options.structuredOutput).toEqual(expect.objectContaining({ jsonPromptInjection: "system" }));
    }
  });

  it("allows successful no-market-data analysis through the publication gate", () => {
    expect(enforcePublicationStatus({
      candidate: decision(),
      criticalMissing: [],
      dataState: "NOT_REQUIRED",
      findings: [finding("PROFILE_CONTEXT")],
      modelFallback: false,
      unresolvedConflict: false,
      marketDataRequired: false,
    } as never)).toBe("ACTIVE");
  });
});

function emptyStream<T>(): ReadableStream<T> {
  return new ReadableStream<T>({ start(controller) { controller.close(); } });
}

function finding(agent: string, conclusion = `${agent} 完成`): Record<string, unknown> {
  return {
    agent,
    conclusion,
    supportEvidence: [],
    counterEvidence: ["反方证据"],
    missingInformation: [],
    risks: [],
    confidence: 0.8,
    needsAnotherAgent: false,
  };
}

function decision(): Record<string, unknown> {
  return {
    action: "WATCH",
    requestedDirection: "HOLD",
    summary: "模型决策完成",
    suitability: "MEDIUM",
    confidence: 0.8,
    rationales: ["理由"],
    counterEvidence: ["反方证据"],
    risks: ["风险"],
    portfolioImpact: "不改变组合",
    invalidationConditions: ["条件变化"],
    compliance: { approved: true, decision: "APPROVED", reason: "通过" },
  };
}
