import { Agent } from "@mastra/core/agent";

import { getDeepSeekModelConfig } from "@/server/chat/environment";

export function createExplorerAgent() {
  return new Agent({
    id: "explorer-agent",
    name: "Explorer",
    description: "拆解问题、澄清事实并给出简洁的分析材料。",
    model: getDeepSeekModelConfig(),
    defaultOptions: {
      maxSteps: 1,
      modelSettings: { maxOutputTokens: 80, temperature: 0.2 },
    },
    instructions: [
      "你是通用分析助手 Explorer。",
      "只处理 Supervisor 委派的问题，提炼事实、约束与可选路径。",
      "最多输出 3 条极短要点（总计不超过 80 个 token），不涉及理财或任何预置业务知识。",
    ].join("\n"),
  });
}
