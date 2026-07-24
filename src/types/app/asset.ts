export type AssetClass = "cash" | "money_market" | "bond_fund" | "equity_fund" | "stock" | "index_fund" | "other";
export type AccountType = "bank" | "securities" | "fund_platform" | "pension" | "other";

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  cash: "现金",
  money_market: "货币基金",
  bond_fund: "债券基金",
  equity_fund: "权益基金",
  stock: "股票",
  index_fund: "指数基金",
  other: "其他",
};

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  bank: "银行",
  securities: "证券",
  fund_platform: "基金平台",
  pension: "养老",
  other: "其他",
};

export interface Holding {
  id: string;
  userId: string;
  accountId: string | null;
  goalId: string | null;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  industry: string | null;
  quantity: number;
  costBasis: number;
  currentPrice: number;
  marketValue: number;
  createdAt: string;
  updatedAt: string;
}

export interface HoldingInput {
  name: string;
  symbol?: string;
  assetClass: AssetClass;
  industry?: string | null;
  quantity: number;
  costBasis?: number;
  currentPrice: number;
  goalId?: string | null;
  accountId?: string | null;
}

export interface HealthMetrics {
  totalAssets: number;
  emergencyMonths: number | null;
  savingsRate: number | null;
  concentration: {
    topClass: AssetClass | null;
    topClassRatio: number;
    topIndustry: string | null;
    topIndustryRatio: number;
  };
  drawdown: number;
  allocation: { assetClass: AssetClass; label: string; ratio: number; value: number }[];
  goalCoverage: number | null;
}
