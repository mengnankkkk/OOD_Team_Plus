import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  prompts: [] as string[],
}));

vi.mock("@mastra/core/agent", () => ({
  Agent: class Agent {
    async stream(prompt: string) {
      harness.prompts.push(prompt);
      const role = prompt.match(/当前角色：(\w+)/u)?.[1];
      return {
        textStream: emptyStream<string>(),
        objectStream: emptyStream<Record<string, unknown>>(),
        object: Promise.resolve(role ? finding(role) : decision()),
      };
    }
  },
}));

import { runChiefAdvisor } from "./chief-advisor";

describe("runChiefAdvisor", () => {
  beforeEach(() => {
    harness.prompts.length = 0;
  });

  it("injects explicit advisor context into specialists and the chief decision prompt", async () => {
    await runChiefAdvisor({
      prompt: "我这笔教育金还能继续买沪深300吗？",
      requiredAgents: ["PROFILE_CONTEXT", "PORTFOLIO_RISK", "RECOMMENDATION", "COMPLIANCE_REVIEWER"],
      context: {
        workflow: "CONVERSATION",
        profile: {
          risk_level: "稳健型",
          investment_amount_decimal: "200000",
          horizon: "3年",
          max_drawdown_decimal: "0.08",
        },
        goals: [{ name: "教育金", targetAmount: "300000", due: "2029-09" }],
        portfolioSnapshot: { cash_decimal: "50000", total_market_value_decimal: "150000" },
        holdings: [{ symbol: "510300", name: "沪深300ETF", weight_bps: 4200 }],
        conversationMemory: [{ role: "user", content: "目标是教育金，最多接受8%回撤" }],
      },
    });

    expect(harness.prompts.length).toBeGreaterThan(1);
    for (const prompt of harness.prompts) {
      expect(prompt).toContain("显式结构化顾问上下文");
      expect(prompt).toContain("\"risk_level\":\"稳健型\"");
      expect(prompt).toContain("\"investment_amount_decimal\":\"200000\"");
      expect(prompt).toContain("\"symbol\":\"510300\"");
      expect(prompt).toContain("禁止重复追问");
    }
    expect(harness.prompts.at(-1)).toContain("你是最终理财顾问，不只是流程调度器");
    expect(harness.prompts.at(-1)).toContain("专业子 Agent 发现");
  });
});

function emptyStream<T>(): ReadableStream<T> {
  return new ReadableStream<T>({ start(controller) { controller.close(); } });
}

function finding(agent: string): Record<string, unknown> {
  return {
    agent,
    conclusion: `${agent} 完成`,
    supportEvidence: ["已基于上下文形成结论"],
    counterEvidence: ["市场变化可能影响结论"],
    missingInformation: [],
    risks: ["波动风险"],
    confidence: 0.8,
    needsAnotherAgent: false,
  };
}

function decision(): Record<string, unknown> {
  return {
    action: "WATCH",
    requestedDirection: "ANALYZE",
    summary: "已结合画像、目标和持仓回答当前追问",
    suitability: "MEDIUM",
    confidence: 0.8,
    rationales: ["画像、目标和持仓上下文已知"],
    counterEvidence: ["市场变化可能影响结论"],
    risks: ["波动风险"],
    portfolioImpact: "先维持组合并设定观察条件",
    invalidationConditions: ["目标或回撤边界变化"],
    compliance: { approved: true, decision: "APPROVED", reason: "通过" },
  };
}
