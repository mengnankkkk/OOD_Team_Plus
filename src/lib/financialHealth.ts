import type { AssetClass, HealthMetrics, Holding } from "@/types/app/asset";
import { ASSET_CLASS_LABEL } from "@/types/app/asset";
import type { UserGoal, UserProfile } from "@/types/app/user";

const CASH_LIKE: AssetClass[] = ["cash", "money_market"];
const EQUITY_LIKE: AssetClass[] = ["equity_fund", "stock", "index_fund"];

const assumedDrawdownByClass: Record<AssetClass, number> = {
  cash: 0.0,
  money_market: 0.005,
  bond_fund: 0.04,
  equity_fund: 0.22,
  stock: 0.28,
  index_fund: 0.2,
  other: 0.1,
};

export interface ConcentrationInsight {
  label: string;
  note: string;
}

export function getConcentrationInsight(metrics: Pick<HealthMetrics, "concentration">): ConcentrationInsight {
  const { topClass, topClassRatio, topIndustry, topIndustryRatio } = metrics.concentration;
  if (!topClass) {
    return { label: "资产类别占比", note: "暂无足够持仓数据" };
  }

  const classLabel = ASSET_CLASS_LABEL[topClass];
  const ratio = `${Math.round(topClassRatio * 100)}%`;
  const industryContext = topIndustry
    ? `其中${topIndustry}行业占总资产${Math.round(topIndustryRatio * 100)}%`
    : null;

  if (EQUITY_LIKE.includes(topClass)) {
    return {
      label: `${classLabel}占比`,
      note: `当前${classLabel}占总资产${ratio}%，组合表现会更多受权益市场波动影响${industryContext ? `，${industryContext}` : ""}。请结合资金用途和风险承受能力判断是否适合。`,
    };
  }

  if (CASH_LIKE.includes(topClass)) {
    return {
      label: `${classLabel}占比`,
      note: `当前${classLabel}占总资产${ratio}%，组合以低波动资产为主。请结合资金用途和投资期限判断是否需要提高资金使用效率。`,
    };
  }

  return {
    label: `${classLabel}占比`,
    note: `当前${classLabel}占总资产${ratio}%，是组合的主要资产类别。是否需要调整要结合资金用途、投资期限和风险承受能力判断。`,
  };
}

export function computeHealthMetrics(holdings: Holding[], profile: UserProfile | null, goals: UserGoal[]): HealthMetrics {
  const totalAssets = holdings.reduce((sum, h) => sum + h.marketValue, 0);

  const classSums = new Map<AssetClass, number>();
  const industrySums = new Map<string, number>();
  for (const h of holdings) {
    classSums.set(h.assetClass, (classSums.get(h.assetClass) ?? 0) + h.marketValue);
    if (h.industry && EQUITY_LIKE.includes(h.assetClass)) {
      industrySums.set(h.industry, (industrySums.get(h.industry) ?? 0) + h.marketValue);
    }
  }

  const cashLikeTotal = CASH_LIKE.reduce((sum, cls) => sum + (classSums.get(cls) ?? 0), 0);
  const monthlyExpense = profile?.monthlyExpense ?? null;
  const monthlyIncome = profile?.monthlyIncome ?? null;
  const emergencyMonths = monthlyExpense && monthlyExpense > 0 ? cashLikeTotal / monthlyExpense : null;
  const savingsRate = monthlyIncome && monthlyIncome > 0 && monthlyExpense !== null
    ? Math.max(0, Math.min(1, (monthlyIncome - monthlyExpense) / monthlyIncome))
    : null;

  let topClass: AssetClass | null = null;
  let topClassValue = 0;
  for (const [cls, val] of classSums) {
    if (val > topClassValue) { topClass = cls; topClassValue = val; }
  }
  const topClassRatio = totalAssets > 0 ? topClassValue / totalAssets : 0;

  let topIndustry: string | null = null;
  let topIndustryValue = 0;
  for (const [ind, val] of industrySums) {
    if (val > topIndustryValue) { topIndustry = ind; topIndustryValue = val; }
  }
  const topIndustryRatio = totalAssets > 0 ? topIndustryValue / totalAssets : 0;

  const drawdown = totalAssets > 0
    ? holdings.reduce((sum, h) => sum + h.marketValue * assumedDrawdownByClass[h.assetClass], 0) / totalAssets
    : 0;

  const allocation = Array.from(classSums.entries())
    .map(([assetClass, value]) => ({
      assetClass,
      label: ASSET_CLASS_LABEL[assetClass],
      value,
      ratio: totalAssets > 0 ? value / totalAssets : 0,
    }))
    .sort((a, b) => b.ratio - a.ratio);

  const primaryGoal = goals[0] ?? null;
  const goalCoverage = primaryGoal && primaryGoal.targetAmount > 0
    ? Math.min(1, primaryGoal.currentAmount / primaryGoal.targetAmount)
    : null;

  return {
    totalAssets,
    emergencyMonths,
    savingsRate,
    concentration: { topClass, topClassRatio, topIndustry, topIndustryRatio },
    drawdown,
    allocation,
    goalCoverage,
  };
}
