export function simulationProviderMessage(
  status: string | null | undefined,
  provider: string | null | undefined,
): string {
  if (status === "QUEUED") return "候选生成已排队，稍后会调用模型和行情数据源。";
  if (status === "RUNNING") return "Chief Advisor 正在调用模型、补充行情数据并校验候选方案。";
  if (status === "SUCCEEDED" && provider === "CHIEF_ADVISOR") return "Chief Advisor 已组织画像、行情研究、风险和合规角色。";
  if (status === "SUCCEEDED" && provider === "DETERMINISTIC_FALLBACK") return "本轮模型候选不可用，已明确降级为确定性 fallback。";
  if (status === "FAILED") return "本轮候选生成失败，请重新发起。";
  return "生成一轮候选方案后，这里会显示模型或规则来源。";
}
