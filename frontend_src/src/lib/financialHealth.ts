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
