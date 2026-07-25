export function deterministicAdvisorSummary(input: {
  targetSymbol: string | null;
  profileReady: boolean;
  hasHoldings: boolean;
  concentrationRisk: boolean;
}): string {
  if (input.targetSymbol) {
    return `${input.targetSymbol} 需要在画像、真实数据、组合风险和合规条件下进行条件化决策`;
  }
  if (!input.profileReady && !input.hasHoldings) {
    return "请先完成投资画像并补充当前持仓，再形成具体标的建议";
  }
  if (!input.profileReady) {
    return "请先完成投资画像，再继续组合诊断";
  }
  if (!input.hasHoldings) {
    return "请先补充当前持仓，完成组合诊断后再形成具体标的建议";
  }
  if (input.concentrationRisk) {
    return "已完成画像与组合诊断，当前应暂停加仓并优先降低集中度";
  }
  return "已完成画像与组合诊断，当前组合以继续观察为主";
}
