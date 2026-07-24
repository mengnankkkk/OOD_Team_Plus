import { concentration, holdingMetrics, stressLoss } from "@/server/advisor/analytics";
import { minorToMoney, ratio } from "@/server/advisor/decimal";
import { MarketDataService, type MarketDataResult } from "@/server/advisor/market-service";
import { json, newId, nowIso, runWrite } from "@/server/advisor/store-common";
import type { AdvisorStore } from "@/server/advisor/store";

export type PortfolioBuild = {
  snapshotId: string;
  marketResults: MarketDataResult[];
  diagnostic: Record<string, unknown>;
};

export type PortfolioHealthStatus = "healthy" | "attention" | "high_risk" | "insufficient_data";

export function derivePortfolioHealth(input: {
  hasHoldings: boolean;
  dataFresh: boolean;
  currentDrawdown: number;
  maxAcceptableDrawdown: number;
  riskFitStatus: string;
  topIssues: Array<{ severity?: string }>;
}) {
  if (!input.hasHoldings) {
    return {
      status: "insufficient_data" as const,
      score: 0,
      reasons: ["尚未录入可分析的持仓。"],
    };
  }

  let score = 100;
  const reasons: string[] = [];
  if (!input.dataFresh) {
    score -= 30;
    reasons.push("至少一项行情或研究数据不是最新可用数据。");
  }
  if (input.riskFitStatus === "MISMATCHED") {
    score -= 35;
    reasons.push("组合集中度超过当前风险画像边界。");
  }
  if (Math.abs(input.currentDrawdown) > input.maxAcceptableDrawdown) {
    score -= 30;
    reasons.push("当前回撤超过用户可接受回撤。");
  }
  if (input.topIssues.some((issue) => issue.severity === "HIGH")) {
    score -= 15;
    reasons.push("组合存在需要优先处理的高优先级风险。");
  }

  const status: PortfolioHealthStatus = score >= 75
    ? "healthy"
    : score >= 50
      ? "attention"
      : "high_risk";
  return { status, score: Math.max(0, score), reasons };
}

export class PortfolioService {
  private readonly market: MarketDataService;

  constructor(private readonly store: AdvisorStore) {
    this.market = new MarketDataService(store);
  }

  async buildSnapshot(userId: string, reason = "diagnosis"): Promise<PortfolioBuild> {
    const holdings = this.store.holdings.listHoldings(userId);
    const marketResults = await Promise.all(holdings.map((holding) => this.market.getSnapshot(holding.instrument)));
    const provisional = holdings.map((holding, index) => {
      const market = marketResults[index];
      const lastPrice = String((market.metrics.technical as Record<string, unknown>).lastPrice ?? holding.averageCost);
      const metrics = holdingMetrics({
        quantity: holding.quantity,
        averageCost: holding.averageCost,
        lastPrice,
        drawdown: Number((market.metrics.technical as Record<string, unknown>).currentDrawdown ?? 0),
      });
      return { holding, market, lastPrice, metrics };
    });
    const investedValue = provisional.reduce((sum, item) => sum + item.metrics.marketValueMinor, 0);
    const cashValue = this.store.holdings.getCashBalance(userId);
    const totalValue = investedValue + cashValue;
    for (const item of provisional) item.metrics.portfolioWeight = ratio(item.metrics.marketValueMinor, totalValue);
    const totalCost = provisional.reduce((sum, item) => sum + item.metrics.costValueMinor, 0);
    const pnl = investedValue - totalCost;
    const concentrationResult = concentration(provisional.map((item) => ({
      valueMinor: item.metrics.marketValueMinor,
      category: item.holding.instrument.assetType,
      sector: item.holding.instrument.sectorName,
    })).concat(cashValue > 0 ? [{ valueMinor: cashValue, category: "CASH", sector: "现金" }] : []));
    const profile = this.store.profile.getProfile(userId);
    const riskFit = riskFitStatus(concentrationResult, profile);
    const issues = topIssues(concentrationResult, riskFit);
    const health = derivePortfolioHealth({
      hasHoldings: holdings.length > 0,
      dataFresh: marketResults.length > 0 && marketResults.every((result) => result.source === "pandadata" && result.fresh),
      currentDrawdown: worstDrawdown(provisional),
      maxAcceptableDrawdown: profile?.maxAcceptableDrawdown ?? 0.15,
      riskFitStatus: String(riskFit.status),
      topIssues: issues,
    });
    const diagnostic = {
      totalMarketValue: minorToMoney(totalValue),
      cashValue: minorToMoney(cashValue),
      totalUnrealizedPnl: minorToMoney(pnl),
      currentDrawdown: worstDrawdown(provisional),
      allocation: Object.entries(concentrationResult.categoryWeights).map(([category, weight]) => ({ category, weight })),
      concentration: concentrationResult,
      riskFit,
      riskLimits: {
        maxAcceptableDrawdown: profile?.maxAcceptableDrawdown ?? null,
        maxSinglePositionWeight: profile?.maxSinglePositionWeight ?? null,
        maxSectorWeight: profile?.maxSectorWeight ?? null,
      },
      health,
      stressTests: [{ scenario: "EQUITY_MARKET_MINUS_20", estimatedPortfolioChange: stressLoss(concentrationResult.categoryWeights) }],
      holdings: provisional.map((item) => holdingDiagnostic(item)),
      topIssues: issues,
      dataSources: marketResults.map((result) => ({
        instrumentId: result.instrument.id,
        source: result.source,
        pandadata: result.pandadata,
        dataAsOf: result.dataAsOf,
      })),
    };
    const snapshot = this.store.analysis.savePortfolioSnapshot({
      userId,
      reason,
      asOf: nowIso(),
      totalValueMinor: totalValue,
      cashValueMinor: cashValue,
      investedValueMinor: investedValue,
      totalCostMinor: totalCost,
      unrealizedPnlMinor: pnl,
      currentDrawdown: Number(diagnostic.currentDrawdown),
      dataQuality: marketResults.some((result) => result.source === "pandadata") ? "complete" : "partial",
      details: diagnostic,
    });
    for (const item of provisional) saveHoldingSnapshot(this.store, snapshot.id, item);
    return { snapshotId: snapshot.id, marketResults, diagnostic };
  }
}

function holdingDiagnostic(item: {
  holding: ReturnType<AdvisorStore["holdings"]["listHoldings"]>[number];
  market: MarketDataResult;
  lastPrice: string;
  metrics: ReturnType<typeof holdingMetrics>;
}) {
  return {
    holdingId: item.holding.id,
    asset: {
      instrumentId: item.holding.instrumentId,
      symbol: item.holding.instrument.symbol,
      name: item.holding.instrument.name,
      assetType: item.holding.instrument.assetType,
    },
    market: { lastPrice: item.lastPrice, dataAsOf: item.market.dataAsOf },
    position: item.metrics,
    valuation: item.market.metrics.valuation,
    fundamentals: item.market.metrics.fundamentals,
    technical: item.market.metrics.technical,
    events: item.market.metrics.events,
  };
}

function saveHoldingSnapshot(
  store: AdvisorStore,
  portfolioSnapshotId: string,
  item: {
    holding: ReturnType<AdvisorStore["holdings"]["listHoldings"]>[number];
    lastPrice: string;
    metrics: ReturnType<typeof holdingMetrics>;
  },
) {
  runWrite(
    store.database,
    `INSERT INTO holding_snapshots
     (id, portfolio_snapshot_id, holding_id, instrument_id, quantity, average_cost,
      market_price, market_value_minor, cost_value_minor, pnl_minor, pnl_ratio,
      portfolio_weight, drawdown, details_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId("holding_snapshot"),
    portfolioSnapshotId,
    item.holding.id,
    item.holding.instrumentId,
    item.holding.quantity,
    item.holding.averageCost,
    item.lastPrice,
    item.metrics.marketValueMinor,
    item.metrics.costValueMinor,
    item.metrics.pnlMinor,
    item.metrics.unrealizedPnlRatio,
    item.metrics.portfolioWeight,
    item.metrics.currentDrawdown,
    json({ marketValue: item.metrics.marketValue }),
  );
}

function riskFitStatus(concentrationResult: ReturnType<typeof concentration>, profile: ReturnType<AdvisorStore["profile"]["getProfile"]>) {
  const maxSector = profile?.maxSectorWeight ?? 0.25;
  const maxSingle = profile?.maxSinglePositionWeight ?? 0.1;
  return {
    effectiveRiskLevel: profile?.effectiveRiskLevel ?? "BALANCED",
    maximumAllowedSectorWeight: maxSector,
    maximumAllowedSingleWeight: maxSingle,
    status: concentrationResult.largestSectorWeight > maxSector || concentrationResult.largestPositionWeight > maxSingle ? "MISMATCHED" : "WITHIN_LIMITS",
  };
}

function topIssues(concentrationResult: ReturnType<typeof concentration>, riskFit: Record<string, unknown>) {
  const issues = [];
  if (riskFit.status === "MISMATCHED") issues.push({ code: "CONCENTRATION_LIMIT", severity: "HIGH", summary: "组合集中度超过当前风险画像上限。" });
  if (concentrationResult.categoryWeights.GOLD_ETF && concentrationResult.categoryWeights.GOLD_ETF > 0.35) {
    issues.push({ code: "GOLD_CONCENTRATION", severity: "HIGH", summary: "黄金仓位偏高，追高前应优先控制组合集中度。" });
  }
  return issues.slice(0, 3);
}

function worstDrawdown(items: Array<{ metrics: ReturnType<typeof holdingMetrics> }>) {
  return Math.min(0, ...items.map((item) => item.metrics.currentDrawdown));
}
