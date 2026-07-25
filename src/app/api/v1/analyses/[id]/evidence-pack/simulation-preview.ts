import Decimal from "decimal.js";

import {
  calculatePortfolioMetrics,
  runPortfolioStressTests,
  type FinancialHolding,
} from "@/server/extensions/analysis/financial-engine";
import { getDatabase, parseJson } from "@/server/http/context";

type Row = Record<string, unknown>;

type SimulationPreviewPoint = {
  label: string;
  concentration: number;
  drawdown: number;
  emergency_months: number;
  totalAssets: number;
  cashAllocation: number;
  concentrationHHI: number;
  maxDrawdown: number;
  bullCaseReturn: number;
  bearCaseReturn: number;
  dataAsOf: string;
  source: string;
  assumptions: string[];
};

export function buildSimulationPreview(
  db: ReturnType<typeof getDatabase>,
  userId: string,
  recommendations: Row[],
  analysisReferenceAt: string,
  portfolioSnapshot?: Row,
) {
  const recommendation = recommendations[0];
  if (!recommendation) return null;
  const branchPreview = buildBranchSimulationPreview(db, userId, recommendations);
  if (branchPreview) return branchPreview;

  const provenance = parseJson<Record<string, unknown>>(String(recommendation.provenance_json ?? "{}"), {});
  const snapshot = resolvePreviewPortfolioSnapshot(
    db,
    userId,
    analysisReferenceAt,
    String(provenance.snapshotId ?? ""),
    portfolioSnapshot,
  );
  if (!snapshot) return null;
  const holdings = db.prepare(`SELECT h.*,i.asset_type,i.sector
    FROM holding_snapshots h JOIN instruments i ON i.id=h.instrument_id
    WHERE h.portfolio_snapshot_id=? ORDER BY h.weight_bps DESC`).all(snapshot.id) as Row[];
  const before = previewPoint("当前组合", String(snapshot.cash_decimal), holdings, String(snapshot.as_of), "PORTFOLIO_SNAPSHOT");
  const projected = projectRecommendationPreview(String(snapshot.cash_decimal), holdings, recommendation);
  const after = previewPoint("按建议模拟", projected.cash, projected.holdings, String(snapshot.as_of), "RECOMMENDATION_PREVIEW");
  return {
    source: "RECOMMENDATION_PREVIEW",
    generatedAt: new Date().toISOString(),
    before,
    after,
    assumptions: [
      "非持久化预览只用于报告页解释，真实分支模拟仍以分支实验室执行结果为准",
      "交易价格使用建议生成时最近的组合快照冻结价格",
      projected.assumption,
    ].filter(Boolean),
  };
}

function buildBranchSimulationPreview(db: ReturnType<typeof getDatabase>, userId: string, recommendations: Row[]) {
  const recommendationIds = recommendations.map((item) => item.id).filter(Boolean);
  if (!recommendationIds.length) return null;
  const workspace = db.prepare(`SELECT * FROM simulation_workspaces
    WHERE user_id=? AND recommendation_id IN (${recommendationIds.map(() => "?").join(",")})
    ORDER BY updated_at DESC,id DESC LIMIT 1`).get(userId, ...recommendationIds) as Row | undefined;
  if (!workspace) return null;
  const root = db.prepare("SELECT * FROM simulation_asset_snapshots WHERE workspace_id=? AND branch_id=?")
    .get(workspace.id, workspace.root_branch_id) as Row | undefined;
  const active = db.prepare("SELECT * FROM simulation_asset_snapshots WHERE workspace_id=? AND branch_id=?")
    .get(workspace.id, workspace.active_branch_id) as Row | undefined;
  if (!root || !active) return null;
  return {
    source: "BRANCH_SIMULATION",
    generatedAt: String(active.created_at ?? root.created_at),
    workspaceId: workspace.id,
    before: previewPointFromSimulationSnapshot(root, "模拟起点"),
    after: previewPointFromSimulationSnapshot(active, "当前分支"),
    assumptions: ["这里展示的是已经写入分支实验室的模拟账本，不影响真实资产。"],
  };
}

function resolvePreviewPortfolioSnapshot(
  db: ReturnType<typeof getDatabase>,
  userId: string,
  analysisReferenceAt: string,
  requestedSnapshotId: string,
  fallback?: Row,
): Row | undefined {
  if (requestedSnapshotId) {
    const snapshot = db.prepare("SELECT * FROM portfolio_snapshots WHERE id=? AND user_id=?")
      .get(requestedSnapshotId, userId) as Row | undefined;
    if (snapshot) return snapshot;
  }
  if (fallback?.id) {
    const snapshot = db.prepare("SELECT * FROM portfolio_snapshots WHERE id=? AND user_id=?")
      .get(fallback.id, userId) as Row | undefined;
    if (snapshot) return snapshot;
  }
  return db.prepare(`SELECT * FROM portfolio_snapshots
    WHERE user_id=? AND as_of<=? ORDER BY as_of DESC,created_at DESC LIMIT 1`)
    .get(userId, analysisReferenceAt) as Row | undefined;
}

function previewPoint(label: string, cash: string, holdings: Row[], dataAsOf: string, source: string): SimulationPreviewPoint {
  const financialHoldings = holdings.map((holding): FinancialHolding => ({
    instrumentId: String(holding.instrument_id ?? holding.instrumentId),
    assetType: String(holding.asset_type ?? holding.assetType ?? "UNKNOWN"),
    sector: holding.sector == null ? null : String(holding.sector),
    quantity: String(holding.quantity_decimal ?? holding.quantity),
    price: String(holding.price_decimal ?? holding.price),
    cost: nullableString(holding.cost_decimal ?? holding.cost),
  }));
  const portfolio = calculatePortfolioMetrics(cash, financialHoldings);
  const stress = runPortfolioStressTests(cash, financialHoldings);
  const worst = stress.reduce((value, item) => Math.min(value, Number(item.changeRatio)), 0);
  const totalAssets = Number(portfolio.totalAssets);
  return {
    label,
    concentration: Number(portfolio.concentrationHhi),
    drawdown: Math.abs(worst),
    emergency_months: emergencyMonths(Number(portfolio.cashValue), totalAssets),
    totalAssets,
    cashAllocation: Number(portfolio.cashAllocation),
    concentrationHHI: Number(portfolio.concentrationHhi),
    maxDrawdown: worst,
    bullCaseReturn: Number(stress.find((item) => item.scenario === "BULL")?.changeRatio ?? 0),
    bearCaseReturn: Number(stress.find((item) => item.scenario === "BEAR")?.changeRatio ?? 0),
    dataAsOf,
    source,
    assumptions: ["压力回撤来自内置组合压力场景，不代表未来收益预测"],
  };
}

function previewPointFromSimulationSnapshot(snapshot: Row, label: string): SimulationPreviewPoint {
  const metrics = parseJson<Record<string, unknown>>(String(snapshot.metrics_json ?? "{}"), {});
  const totalAssets = Number(metrics.totalAssets ?? Number(snapshot.cash_decimal ?? 0) + Number(snapshot.total_market_value_decimal ?? 0));
  const maxDrawdown = Number(metrics.maxDrawdown ?? 0);
  return {
    label,
    concentration: Number(metrics.concentrationHHI ?? 0),
    drawdown: Math.abs(maxDrawdown),
    emergency_months: emergencyMonths(Number(snapshot.cash_decimal ?? 0), totalAssets),
    totalAssets,
    cashAllocation: totalAssets > 0 ? Number(snapshot.cash_decimal ?? 0) / totalAssets : 0,
    concentrationHHI: Number(metrics.concentrationHHI ?? 0),
    maxDrawdown,
    bullCaseReturn: Number(metrics.bullCaseReturn ?? 0),
    bearCaseReturn: Number(metrics.bearCaseReturn ?? 0),
    dataAsOf: String(metrics.dataAsOf ?? snapshot.created_at),
    source: "BRANCH_SIMULATION",
    assumptions: ["来自分支实验室已保存模拟结果"],
  };
}

function projectRecommendationPreview(cashDecimal: string, holdings: Row[], recommendation: Row) {
  const action = String(recommendation.action ?? "WATCH").toUpperCase();
  const feeRate = new Decimal("0.001");
  let cash = decimal(cashDecimal);
  const projected = holdings.map((holding) => ({ ...holding }));
  const targetIndex = findTargetHoldingIndex(projected, recommendation);
  let assumption = "当前建议为观察或持有，预览不改变持仓，只展示基线风险。";

  if (targetIndex >= 0 && ["SCALE_OUT", "EXIT", "REDUCE", "STOP_ADDING"].includes(action)) {
    const holding = projected[targetIndex];
    const ratio = action === "EXIT" ? new Decimal(1) : action === "STOP_ADDING" ? new Decimal(0) : new Decimal("0.25");
    const quantity = decimal(String(holding.quantity_decimal)).mul(ratio).toDecimalPlaces(8, Decimal.ROUND_DOWN);
    if (quantity.gt(0)) {
      const price = decimal(String(holding.price_decimal));
      cash = cash.plus(quantity.mul(price).mul(new Decimal(1).minus(feeRate)));
      holding.quantity_decimal = clean(decimal(String(holding.quantity_decimal)).minus(quantity));
      holding.market_value_decimal = clean(decimal(String(holding.quantity_decimal)).mul(price));
      assumption = action === "EXIT" ? "按退出建议卖出目标持仓。" : "按建议方向先模拟减持目标持仓 25%。";
    }
  } else if (targetIndex >= 0 && ["SCALE_IN", "TRIAL_BUY", "ADD", "BUY"].includes(action)) {
    const holding = projected[targetIndex];
    const budget = Decimal.min(cash.mul("0.25"), totalAssets(cash, projected).mul("0.1"));
    const price = decimal(String(holding.price_decimal));
    const quantity = budget.div(price.mul(new Decimal(1).plus(feeRate))).toDecimalPlaces(8, Decimal.ROUND_DOWN);
    if (quantity.gt(0)) {
      cash = cash.minus(quantity.mul(price).mul(new Decimal(1).plus(feeRate)));
      holding.quantity_decimal = clean(decimal(String(holding.quantity_decimal)).plus(quantity));
      holding.market_value_decimal = clean(decimal(String(holding.quantity_decimal)).mul(price));
      assumption = "按建议方向先模拟使用可用现金的 25% 试仓或加仓。";
    }
  }

  return {
    cash: clean(cash),
    holdings: projected.filter((holding) => decimal(String(holding.quantity_decimal)).gt(0)),
    assumption,
  };
}

function findTargetHoldingIndex(holdings: Row[], recommendation: Row): number {
  const target = String(recommendation.instrument_id ?? "");
  const byInstrument = target ? holdings.findIndex((holding) => String(holding.instrument_id) === target) : -1;
  if (byInstrument >= 0) return byInstrument;
  return holdings.reduce((bestIndex, holding, index) => {
    if (bestIndex < 0) return index;
    return decimal(String(holding.market_value_decimal)).gt(decimal(String(holdings[bestIndex].market_value_decimal))) ? index : bestIndex;
  }, -1);
}

function totalAssets(cash: Decimal, holdings: Row[]): Decimal {
  return holdings.reduce((total, holding) => total.plus(decimal(String(holding.market_value_decimal))), cash);
}

function emergencyMonths(cash: number, totalAssetsValue: number): number {
  const monthlyNeed = Math.max(totalAssetsValue * 0.03, 3_000);
  return Number.isFinite(cash) && monthlyNeed > 0 ? Number((cash / monthlyNeed).toFixed(2)) : 0;
}

function decimal(value: string): Decimal {
  const result = new Decimal(value || "0");
  return result.isFinite() && !result.isNegative() ? result : new Decimal(0);
}

function clean(value: Decimal): string {
  return value.toDecimalPlaces(12).toFixed().replace(/\.0+$/u, "").replace(/(\.\d*?)0+$/u, "$1");
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}
