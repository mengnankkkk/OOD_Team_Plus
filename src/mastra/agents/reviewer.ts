import { Agent } from "@mastra/core/agent";

import { getDeepSeekModelConfig } from "@/server/chat/environment";

export function createReviewerAgent() {
  return new Agent({
    id: "reviewer-agent",
    name: "Reviewer",
    description: "检查已有分析的遗漏、矛盾和表达质量。",
    model: getDeepSeekModelConfig(),
    defaultOptions: {
      maxSteps: 1,
      modelSettings: { maxOutputTokens: 80, temperature: 0.2 },
    },
    instructions: [
      "你是通用复核助手 Reviewer。",
      "检查 Supervisor 提供的材料，指出遗漏、矛盾与不清晰之处。",
      "最多输出 3 条极短要点（总计不超过 80 个 token），不涉及理财或任何预置业务知识。",
    ].join("\n"),
  });
}
