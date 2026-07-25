export function simulationProviderMessage(
  status: string | null | undefined,
  provider: string | null | undefined,
  fallbackReason?: string | null,
): string {
  if (status === "QUEUED") return "候选生成已排队，稍后会调用模型和行情数据源。";
  if (status === "RUNNING") return "Chief Advisor 正在调用模型、补充行情数据并校验候选方案。";
  if (status === "SUCCEEDED" && provider === "CHIEF_ADVISOR") return "Chief Advisor 已组织画像、行情研究、风险和合规角色。";
  if (status === "SUCCEEDED" && provider === "DETERMINISTIC_FALLBACK" && fallbackReason === "MODEL_NOT_CONFIGURED") return "未配置模型密钥，本轮使用确定性方案。";
  if (status === "SUCCEEDED" && provider === "DETERMINISTIC_FALLBACK" && fallbackReason === "MODEL_OUTPUT_INVALID") return "模型已响应，但候选结构不完整；服务端已使用确定性方案。";
  if (status === "SUCCEEDED" && provider === "DETERMINISTIC_FALLBACK" && fallbackReason === "SCENARIO_VALIDATION_FAILED") return "模型已响应，但所有候选交易均不可执行；服务端已使用确定性方案。";
  if (status === "SUCCEEDED" && provider === "DETERMINISTIC_FALLBACK") return "本轮模型候选不可用，已明确降级为确定性 fallback。";
  if (status === "FAILED") return "本轮候选生成失败，请重新发起。";
  return "生成一轮候选方案后，这里会显示模型或规则来源。";
}
