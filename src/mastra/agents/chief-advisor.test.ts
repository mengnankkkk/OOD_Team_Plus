import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  streamOptions: [] as Array<Record<string, unknown>>,
  prompts: [] as string[],
  decisionOutput: null as Record<string, unknown> | null,
  conversationOutput: "你好，我是你的理财顾问。你最近最想解决哪件财务问题？",
}));

vi.mock("@mastra/core/agent", () => ({
  Agent: class Agent {
    async stream(prompt: string, options: Record<string, unknown>) {
      harness.streamOptions.push(options);
      harness.prompts.push(prompt);
      const role = prompt.match(/当前角色：(\w+)/u)?.[1];
      return {
        textStream: streamValues([harness.conversationOutput]),
        objectStream: emptyStream<Record<string, unknown>>(),
        object: Promise.resolve(role ? finding(role) : harness.decisionOutput ?? decision()),
      };
    }
  },
}));

import { runChiefAdvisor, runChiefAdvisorConversation } from "./chief-advisor";

describe("Chief Advisor structured decision", () => {
  beforeEach(() => {
    harness.streamOptions.length = 0;
    harness.prompts.length = 0;
    harness.decisionOutput = null;
  });

  it("answers ordinary chat as the Chief Advisor without a structured decision prompt", async () => {
    const result = await runChiefAdvisorConversation({
      question: "你好",
      context: {
        profile: { risk_level: "BALANCED", horizon: "LONG" },
        holdings: [{ symbol: "510300", weight_bps: 4000 }],
      },
    });

    expect(result.answer).toContain("理财顾问");
    expect(harness.prompts.at(-1)).toContain("普通理财顾问对话");
    expect(harness.prompts.at(-1)).toContain("不要输出建议状态");
    expect(harness.prompts.at(-1)).toContain("\"risk_level\":\"BALANCED\"");
    expect(harness.streamOptions.at(-1)).not.toHaveProperty("structuredOutput");
  });

  it("returns the model-generated debate suggestion with the advisor decision", async () => {
    const result = await runChiefAdvisor({
      prompt: "请分析当前标的是否值得继续持有",
      requiredAgents: ["PROFILE_CONTEXT"],
    });

    expect(result.decision.debateSuggestion).toEqual({
      recommended: true,
      motion: "未来 1-3 个月是否应继续持有该标的",
      reason: "多空证据存在真实分歧，适合让用户比较双方依据",
    });
  });

  it("marks a default-filled Chief decision incomplete and downgrades it with field reasons", async () => {
    harness.decisionOutput = {
      action: "WATCH",
      requestedDirection: "HOLD",
      compliance: { approved: true },
    };

    const result = await runChiefAdvisor({
      prompt: "请分析当前标的是否值得继续持有",
      requiredAgents: ["PROFILE_CONTEXT"],
    });

    expect(result.decisionIntegrity).toMatchObject({
      complete: false,
      defaultedFields: expect.arrayContaining([
        "counterEvidence",
        "portfolioImpact",
        "invalidationConditions",
        "compliance.decision",
        "compliance.reason",
      ]),
    });
    expect(result.decision.compliance).toMatchObject({
      approved: false,
      decision: "DOWNGRADED",
    });
    expect(result.decision.compliance.reason).toContain("counterEvidence");
  });

  it("treats whitespace values replaced by coercion as incomplete", async () => {
    harness.decisionOutput = {
      ...decision(),
      summary: " ",
      rationales: [" "],
      counterEvidence: [" "],
      risks: [" "],
      portfolioImpact: " ",
      invalidationConditions: [" "],
      compliance: { approved: true, decision: "APPROVED", reason: " " },
    };

    const result = await runChiefAdvisor({
      prompt: "请分析当前标的是否值得继续持有",
      requiredAgents: ["PROFILE_CONTEXT"],
    });

    expect(result.decisionIntegrity).toMatchObject({
      complete: false,
      defaultedFields: expect.arrayContaining([
        "summary",
        "counterEvidence.0",
        "portfolioImpact",
        "compliance.reason",
      ]),
    });
    expect(result.decision.compliance.decision).toBe("DOWNGRADED");
  });
});

function emptyStream<T>(): ReadableStream<T> {
  return new ReadableStream<T>({ start(controller) { controller.close(); } });
}

function streamValues<T>(values: T[]): ReadableStream<T> {
  return new ReadableStream<T>({
    start(controller) {
      for (const value of values) controller.enqueue(value);
      controller.close();
    },
  });
}

function finding(agent: string): Record<string, unknown> {
  return {
    agent,
    conclusion: `${agent} 已形成结论`,
    supportEvidence: ["支持证据"],
    counterEvidence: ["反方证据"],
    missingInformation: [],
    risks: ["风险"],
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
    debateSuggestion: {
      recommended: true,
      motion: "未来 1-3 个月是否应继续持有该标的",
      reason: "多空证据存在真实分歧，适合让用户比较双方依据",
    },
  };
}
