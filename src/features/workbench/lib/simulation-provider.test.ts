import { describe, expect, it } from "vitest";

import { simulationProviderMessage } from "./simulation-provider";

describe("simulationProviderMessage", () => {
  it("does not claim fallback while the provider is still unresolved", () => {
    expect(simulationProviderMessage("RUNNING", null)).toBe("Chief Advisor 正在调用模型、补充行情数据并校验候选方案。");
    expect(simulationProviderMessage("QUEUED", undefined)).toBe("候选生成已排队，稍后会调用模型和行情数据源。");
  });

  it("shows the provider only after generation completes", () => {
    expect(simulationProviderMessage("SUCCEEDED", "CHIEF_ADVISOR")).toBe("Chief Advisor 已组织画像、行情研究、风险和合规角色。");
    expect(simulationProviderMessage("SUCCEEDED", "DETERMINISTIC_FALLBACK")).toBe("本轮模型候选不可用，已明确降级为确定性 fallback。");
  });

  it("explains whether fallback came from model structure or trade validation", () => {
    expect(simulationProviderMessage("SUCCEEDED", "DETERMINISTIC_FALLBACK", "MODEL_OUTPUT_INVALID")).toBe("模型已响应，但候选结构不完整；服务端已使用确定性方案。");
    expect(simulationProviderMessage("SUCCEEDED", "DETERMINISTIC_FALLBACK", "SCENARIO_VALIDATION_FAILED")).toBe("模型已响应，但所有候选交易均不可执行；服务端已使用确定性方案。");
  });
});
