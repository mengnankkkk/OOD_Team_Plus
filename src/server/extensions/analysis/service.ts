import Decimal from "decimal.js";

import { createExtensionError, ExtensionErrorCode, type ExtensionError } from "@/server/extensions/errors/codes";
import type { PandaDataMethod } from "@/server/extensions/pandadata/adapter";
import { executePandaSources } from "@/server/extensions/query/panda-query-executor";
import type { MarketDatasetKey, PandaQuerySource } from "@/server/extensions/query/market-catalog";
import { persistSseEvent } from "@/server/extensions/sse/event-persister";
import { createId, getDatabase, isoNow, json, parseJson } from "@/server/http/context";

import { calculatePortfolioScore, type HoldingSnapshot } from "./scoring";
import { calculatePortfolioMetrics as calculateFinancialPortfolio, calculateTechnicalIndicators, runPortfolioStressTests } from "./financial-engine";

type HoldingRow = Record<string, unknown>;

interface RefreshHolding extends HoldingRow {
  instrument_id: string;
  symbol: string;
  market: string;
  asset_type: string;
  quantity_decimal: string;
  cost_decimal: string;
  previous_price: string | null;
}

interface PricePoint {
  symbol: string;
  date: string;
  close: string;
}

interface SourceStatus {
  source: string;
  status: "SUCCEEDED" | "FAILED" | "FALLBACK";
  resultCount?: number;
  error?: { code: string; message: string; retryable: boolean };
}

export function getLatestSnapshot(userId: string, requestedId?: string) {
  const db = getDatabase();
  const row = requestedId
    ? db.prepare("SELECT * FROM portfolio_snapshots WHERE id = ? AND user_id = ?").get(requestedId, userId) as Record<string, unknown> | undefined
    : db.prepare("SELECT * FROM portfolio_snapshots WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").get(userId) as Record<string, unknown> | undefined;
  db.close();
  return row;
}

export function getPortfolioHoldings(userId: string, snapshotId?: string) {
  const snapshot = getLatestSnapshot(userId, snapshotId);
  if (!snapshot) return null;
  const db = getDatabase();
  const rawRows = db.prepare(`SELECT h.*, i.symbol, i.name, i.asset_type, i.market, i.sector
    FROM holding_snapshots h LEFT JOIN instruments i ON i.id = h.instrument_id
    WHERE h.portfolio_snapshot_id = ?`).all(snapshot.id) as HoldingRow[];
  const history = db.prepare(`SELECT h.instrument_id,h.price_decimal
    FROM holding_snapshots h JOIN portfolio_snapshots ps ON ps.id=h.portfolio_snapshot_id
    WHERE ps.user_id=? AND ps.portfolio_id=? AND ps.as_of<=?
    ORDER BY ps.as_of,ps.created_at,h.created_at`).all(userId, snapshot.portfolio_id, snapshot.as_of) as Array<Record<string, unknown>>;
  db.close();
  const rows = [...rawRows].sort((left, right) => financialDecimal(right.market_value_decimal).comparedTo(financialDecimal(left.market_value_decimal)));
  const historyByInstrument = new Map<string, Decimal[]>();
  for (const item of history) {
    const key = String(item.instrument_id);
    historyByInstrument.set(key, [...(historyByInstrument.get(key) ?? []), financialDecimal(item.price_decimal)]);
  }
  const financial = calculateFinancialPortfolio(String(snapshot.cash_decimal), rows.map((row) => ({
    instrumentId: String(row.instrument_id), assetType: String(row.asset_type ?? "stock").toUpperCase(), sector: row.sector == null ? null : String(row.sector),
    quantity: String(row.quantity_decimal), price: String(row.price_decimal), cost: String(row.cost_decimal),
  })));
  const metricsByInstrument = new Map(financial.holdings.map((item) => [item.instrumentId, item]));
  const items = rows.map((row) => {
    const itemHistory = historyByInstrument.get(String(row.instrument_id)) ?? [];
    const price = financialDecimal(row.price_decimal);
    const peak = [...itemHistory, financialDecimal(row.cost_decimal), price].reduce((value, item) => Decimal.max(value, item), price);
    const calculated = metricsByInstrument.get(String(row.instrument_id))!;
    return {
      holdingId: row.id, instrumentId: row.instrument_id, assetType: String(row.asset_type ?? "stock").toUpperCase(),
      symbol: row.symbol, name: row.name, quantity: row.quantity_decimal, averageCost: row.cost_decimal,
      marketPrice: calculated.price, marketValue: calculated.marketValue, weight: Number(calculated.weight),
      unrealizedPnl: calculated.unrealizedPnl,
      unrealizedPnlRate: calculated.unrealizedPnlRate == null ? null : Number(calculated.unrealizedPnlRate),
      drawdown: peak.gt(0) ? price.div(peak).minus(1).toNumber() : null,
      drawdownWindowDays: itemHistory.length, sector: row.sector,
    };
  });
  return {
    portfolioSnapshotId: snapshot.id,
    asOf: snapshot.as_of,
    dataQuality: String(snapshot.data_quality ?? "complete").toUpperCase(),
    sourceStatuses: parseJson(String(snapshot.source_statuses_json ?? "[]"), []),
    summary: { totalValue: financial.totalMarketValue, cashValue: financial.cashValue, totalAssets: financial.totalAssets, unrealizedPnl: financial.unrealizedPnl },
    items,
  };
}

export function getPortfolioMetrics(userId: string, snapshotId?: string) {
  const snapshot = getLatestSnapshot(userId, snapshotId);
  if (!snapshot) return null;
  const view = getPortfolioHoldings(userId, String(snapshot.id));
  const holdings: HoldingSnapshot[] = (view?.items ?? []).map((item) => ({ instrumentId: String(item.instrumentId), quantity: String(item.quantity), price: String(item.marketPrice), marketValue: String(item.marketValue), weightBps: new Decimal(item.weight).mul(10_000).toDecimalPlaces(0).toNumber() }));
  const analytics = derivePortfolioAnalytics(userId, snapshot, view);
  const score = calculatePortfolioScore(
    Number(view?.summary.totalValue ?? 0), holdings, analytics.totalReturnPct,
    analytics.maxDrawdownPct, analytics.annualVolatilityPct ?? undefined, analytics.liquidityScore,
  );
  const db = getDatabase();
  persistScore(db, String(snapshot.id), score);
  db.close();
  return {
    portfolioSnapshotId: snapshot.id, portfolioId: snapshot.portfolio_id, scoreVersion: score.scoreVersion,
    healthScore: score.healthScore, riskScore: score.riskScore,
    metrics: {
      totalValue: Number(analytics.totalAssets), marketValue: Number(view?.summary.totalValue ?? 0), cashValue: Number(view?.summary.cashValue ?? 0),
      unrealizedPnl: Number(view?.summary.unrealizedPnl ?? 0), totalReturn: analytics.totalReturnPct / 100,
      maxDrawdown: analytics.maxDrawdownPct / 100, annualVolatility: analytics.annualVolatilityPct == null ? null : analytics.annualVolatilityPct / 100,
      concentrationHhi: analytics.concentrationHhi, topHoldingWeight: analytics.topHoldingWeight,
      cashAllocation: analytics.cashAllocation, liquidityScore: analytics.liquidityScore,
    },
    allocation: { bySector: analytics.bySector, byAssetType: analytics.byAssetType },
    components: Object.entries(score.components).map(([code, value]) => ({ code: code.toUpperCase(), score: value, quality: "VALID" })),
    stressTests: analytics.stressTests,
    missingMetrics: [...new Set([...score.missingMetrics, ...analytics.missingMetrics])], observationCount: analytics.observationCount,
    dataQuality: view?.dataQuality, sourceStatuses: view?.sourceStatuses, asOf: snapshot.as_of,
  };
}

export function getPortfolioTrends(userId: string, snapshotId?: string) {
  const snapshot = getLatestSnapshot(userId, snapshotId);
  if (!snapshot) return null;
  const db = getDatabase();
  const snapshots = db.prepare(`SELECT id,as_of,cash_decimal,total_market_value_decimal
    FROM portfolio_snapshots WHERE user_id=? AND portfolio_id=? AND as_of<=?
    ORDER BY as_of,created_at,id`).all(userId, snapshot.portfolio_id, snapshot.as_of) as Array<Record<string, unknown>>;
  const concentrationRows = db.prepare(`SELECT ps.id,h.weight_bps
    FROM portfolio_snapshots ps LEFT JOIN holding_snapshots h ON h.portfolio_snapshot_id=ps.id
    WHERE ps.user_id=? AND ps.portfolio_id=? AND ps.as_of<=?`).all(userId, snapshot.portfolio_id, snapshot.as_of) as Array<Record<string, unknown>>;
  db.close();
  const hhiBySnapshot = new Map<string, Decimal>();
  for (const row of concentrationRows) {
    const id = String(row.id);
    const weight = financialDecimal(row.weight_bps ?? 0).div(10_000);
    hhiBySnapshot.set(id, (hhiBySnapshot.get(id) ?? new Decimal(0)).plus(weight.pow(2)));
  }
  const values = snapshots.map((row) => ({
    id: String(row.id),
    date: String(row.as_of).slice(0, 10),
    value: financialDecimal(row.cash_decimal).plus(financialDecimal(row.total_market_value_decimal)),
  }));
  const currentView = getPortfolioHoldings(userId, String(snapshot.id));
  const costBasis = financialDecimal(currentView?.summary.cashValue ?? 0).plus((currentView?.items ?? []).reduce(
    (sum, item) => sum.plus(financialDecimal(item.averageCost).mul(financialDecimal(item.quantity))),
    new Decimal(0),
  ));
  if (values.length === 1 && costBasis.gt(0)) {
    const baseline = new Date(String(snapshot.as_of));
    baseline.setUTCDate(baseline.getUTCDate() - 30);
    values.unshift({ id: "cost-basis", date: baseline.toISOString().slice(0, 10), value: costBasis });
  }
  const base = values[0]?.value.gt(0) ? values[0].value : new Decimal(1);
  let peak = base;
  const observedValues: string[] = [];
  const totalReturn = values.map((point, index) => {
    observedValues.push(point.value.toString());
    return { date: point.date, value: decimalDisplay(point.value.div(base).minus(1)) };
  });
  const drawdown = values.map((point) => {
    peak = Decimal.max(peak, point.value);
    return { date: point.date, value: decimalDisplay(peak.gt(0) ? point.value.div(peak).minus(1) : new Decimal(0)) };
  });
  const volatility = values.map((point, index) => {
    const indicator = calculateTechnicalIndicators(observedValues.slice(0, index + 1));
    return { date: point.date, value: indicator.annualVolatility == null ? null : decimalDisplay(financialDecimal(indicator.annualVolatility)) };
  });
  const concentration = values.map((point) => ({
    date: point.date,
    value: decimalDisplay(hhiBySnapshot.get(point.id) ?? new Decimal(0)),
  }));
  return {
    portfolioSnapshotId: snapshot.id,
    trends: [
      { metric: "total_return", points: totalReturn }, { metric: "drawdown", points: drawdown },
      { metric: "volatility", points: volatility }, { metric: "concentration", points: concentration },
    ],
    source: values.some((value) => value.id === "cost-basis") ? "LOCAL_SNAPSHOT_AND_COST_BASIS" : "LOCAL_SNAPSHOTS",
    modelVersion: "portfolio-trend-v2", observationCount: snapshots.length, asOf: snapshot.as_of,
  };
}

function derivePortfolioAnalytics(userId: string, snapshot: Record<string, unknown>, view: ReturnType<typeof getPortfolioHoldings>) {
  const items = view?.items ?? [];
  const financialHoldings = items.map((item) => ({ instrumentId: String(item.instrumentId), assetType: item.assetType, sector: item.sector == null ? null : String(item.sector), quantity: String(item.quantity), price: String(item.marketPrice), cost: String(item.averageCost) }));
  const financial = calculateFinancialPortfolio(String(view?.summary.cashValue ?? "0"), financialHoldings);
  const totalAssets = financialDecimal(financial.totalAssets);
  const cashValue = financialDecimal(financial.cashValue);
  const costBasis = cashValue.plus(items.reduce((sum, item) => sum.plus(financialDecimal(item.averageCost).mul(financialDecimal(item.quantity))), new Decimal(0)));
  const totalReturnPct = costBasis.gt(0) ? totalAssets.div(costBasis).minus(1).mul(100).toNumber() : 0;
  const concentrationHhi = Number(financial.concentrationHhi);
  const topHoldingWeight = Number(financial.largestPositionWeight);
  const bySector = allocation(items, (item) => String(item.sector ?? "未分类"));
  const byAssetType = allocation(items, (item) => String(item.assetType));
  const liquidityByType: Record<string, string> = { STOCK: "0.92", ETF: "0.95", INDEX: "0.90", FUND: "0.75" };
  const investedLiquidity = financial.holdings.reduce((sum, item) => sum.plus(financialDecimal(item.weight).mul(liquidityByType[item.assetType] ?? "0.55")), new Decimal(0));
  const cashAllocationValue = totalAssets.gt(0) ? cashValue.div(totalAssets) : new Decimal(0);
  const liquidityScore = investedLiquidity.mul(new Decimal(1).minus(cashAllocationValue)).plus(cashAllocationValue).mul(100).toNumber();
  const db = getDatabase();
  const history = db.prepare(`SELECT cash_decimal,total_market_value_decimal FROM portfolio_snapshots
    WHERE user_id=? AND portfolio_id=? AND as_of<=? ORDER BY as_of,created_at,id`).all(userId, snapshot.portfolio_id, snapshot.as_of) as Array<Record<string, unknown>>;
  db.close();
  const values = history.map((row) => financialDecimal(row.cash_decimal).plus(financialDecimal(row.total_market_value_decimal)).toString());
  const indicators = values.length ? calculateTechnicalIndicators(values) : null;
  const holdingDrawdown = items.reduce((value, item) => item.drawdown == null ? value : Decimal.min(value, item.drawdown), new Decimal(0));
  const maxDrawdown = indicators?.maxDrawdown == null ? holdingDrawdown : financialDecimal(indicators.maxDrawdown);
  const annualVolatilityPct = indicators?.annualVolatility == null ? null : financialDecimal(indicators.annualVolatility).mul(100).toNumber();
  const stressTests = runPortfolioStressTests(financial.cashValue, financialHoldings);
  return {
    totalAssets: financial.totalAssets,
    totalReturnPct,
    maxDrawdownPct: maxDrawdown.mul(100).toNumber(),
    annualVolatilityPct,
    concentrationHhi,
    topHoldingWeight,
    cashAllocation: Number(financial.cashAllocation),
    liquidityScore,
    bySector,
    byAssetType,
    observationCount: history.length,
    stressTests,
    missingMetrics: indicators?.annualVolatility == null ? ["ANNUAL_VOLATILITY_REQUIRES_AT_LEAST_3_PORTFOLIO_SNAPSHOTS"] : [],
  };
}

function allocation(items: NonNullable<ReturnType<typeof getPortfolioHoldings>>["items"], key: (item: NonNullable<ReturnType<typeof getPortfolioHoldings>>["items"][number]) => string) {
  const totals = new Map<string, Decimal>();
  for (const item of items) totals.set(key(item), (totals.get(key(item)) ?? new Decimal(0)).plus(financialDecimal(item.marketValue)));
  const total = [...totals.values()].reduce((sum, value) => sum.plus(value), new Decimal(0));
  return [...totals.entries()].map(([name, value]) => ({ name, value: value.toNumber(), weight: total.gt(0) ? value.div(total).toNumber() : 0 })).sort((a, b) => b.value - a.value);
}

export async function refreshPortfolio(userId: string, portfolioId: string) {
  const db = getDatabase();
  const previous = db.prepare("SELECT * FROM portfolio_snapshots WHERE user_id = ? AND portfolio_id = ? ORDER BY created_at DESC LIMIT 1").get(userId, portfolioId) as Record<string, unknown> | undefined;
  const holdings = db.prepare(`SELECT h.*, i.symbol, i.market, i.asset_type,
      (SELECT hs.price_decimal FROM holding_snapshots hs
       JOIN portfolio_snapshots ps ON ps.id = hs.portfolio_snapshot_id
       WHERE ps.user_id = h.user_id AND ps.portfolio_id = h.portfolio_id AND hs.instrument_id = h.instrument_id
       ORDER BY ps.created_at DESC, hs.created_at DESC LIMIT 1) AS previous_price
    FROM holdings h JOIN instruments i ON i.id = h.instrument_id
    WHERE h.user_id = ? AND h.portfolio_id = ? AND h.status = 'active'
    ORDER BY h.created_at`).all(userId, portfolioId) as RefreshHolding[];
  const activeRun = db.prepare("SELECT id FROM agent_runs WHERE user_id = ? AND type = 'portfolio_refresh' AND status IN ('queued','running') LIMIT 1").get(userId);
  if (!previous || holdings.length === 0) {
    db.close();
    throw createExtensionError(ExtensionErrorCode.RESOURCE_NOT_FOUND, "Portfolio or active holdings not found");
  }
  if (activeRun) {
    db.close();
    throw createExtensionError(ExtensionErrorCode.VERSION_CONFLICT, "A portfolio refresh is already running", { code: "RUN_ALREADY_ACTIVE" }, true);
  }

  const now = isoNow();
  const analysisId = createId("analysis");
  db.prepare("INSERT INTO agent_runs (id,user_id,type,status,created_at) VALUES (?,?,?,?,?)").run(analysisId, userId, "portfolio_refresh", "running", now);
  db.close();
  persistSseEvent({ analysisId, type: "agent.started", payload: { type: "PORTFOLIO_REFRESH", portfolioId } });

  try {
    const marketData = await fetchLatestPrices(holdings, analysisId);
    if (marketData.successfulSources === 0) {
      throw marketData.firstError ?? createExtensionError(ExtensionErrorCode.PANDA_DATA_UNAVAILABLE, "No market data source returned successfully", undefined, true);
    }

    const values = holdings.map((holding) => {
      const quote = marketData.prices.get(holding.symbol);
      const fallbackPrice = financialDecimal(holding.previous_price ?? holding.cost_decimal);
      const price = quote ? financialDecimal(quote.close) : fallbackPrice;
      const quantity = financialDecimal(holding.quantity_decimal);
      const cost = financialDecimal(holding.cost_decimal);
      const marketValue = quantity.mul(price);
      return {
        instrumentId: holding.instrument_id,
        symbol: holding.symbol,
        quantity: holding.quantity_decimal,
        cost: holding.cost_decimal,
        price: financialString(price),
        marketValue: financialString(marketValue),
        pnl: financialString(price.minus(cost).mul(quantity)),
        usedFallback: !quote,
      };
    });
    const missingSymbols = values.filter((value) => value.usedFallback).map((value) => value.symbol);
    const sourceStatuses = [...marketData.statuses];
    if (missingSymbols.length) sourceStatuses.push({ source: "PREVIOUS_SNAPSHOT", status: "FALLBACK", resultCount: missingSymbols.length });
    const dataQuality = missingSymbols.length || sourceStatuses.some((source) => source.status === "FAILED") ? "partial" : "complete";
    const totalMarketValue = values.reduce((sum, value) => sum.plus(value.marketValue), new Decimal(0));
    const snapshotId = createId("portfolio_snapshot");
    const publishedAt = isoNow();
    const publishDb = getDatabase();
    const scoreInputs = values.map((value) => ({ instrumentId: value.instrumentId, quantity: value.quantity, price: value.price, marketValue: value.marketValue, weightBps: weightBps(value.marketValue, totalMarketValue) }));
    const score = calculatePortfolioScore(financialString(totalMarketValue), scoreInputs);
    const publish = publishDb.transaction(() => {
      publishDb.prepare("INSERT INTO portfolio_snapshots (id,user_id,portfolio_id,cash_decimal,total_market_value_decimal,data_quality,source_statuses_json,as_of,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(snapshotId, userId, portfolioId, previous.cash_decimal, financialString(totalMarketValue), dataQuality, json(sourceStatuses), publishedAt, publishedAt);
      for (const value of values) {
        publishDb.prepare(`INSERT INTO holding_snapshots
          (id,portfolio_snapshot_id,instrument_id,quantity_decimal,cost_decimal,price_decimal,market_value_decimal,unrealized_pnl_decimal,weight_bps,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(createId("holding_snapshot"), snapshotId, value.instrumentId, value.quantity, value.cost, value.price, value.marketValue, value.pnl, weightBps(value.marketValue, totalMarketValue), publishedAt);
      }
      persistScore(publishDb, snapshotId, score);
      publishDb.prepare("UPDATE agent_runs SET status='completed', completed_at=? WHERE id=? AND user_id=?").run(publishedAt, analysisId, userId);
    });
    publish();
    publishDb.close();
    persistSseEvent({ analysisId, type: "portfolio.refreshed", payload: { portfolioSnapshotId: snapshotId, dataQuality: dataQuality.toUpperCase(), missingSymbols } });
    persistSseEvent({ analysisId, type: "agent.completed", payload: { type: "PORTFOLIO_REFRESH", portfolioSnapshotId: snapshotId } });
    return { snapshotId, analysisId, asOf: publishedAt, dataQuality: dataQuality.toUpperCase(), sourceStatuses };
  } catch (error) {
    const normalized = normalizeExtensionError(error);
    const failureDb = getDatabase();
    failureDb.prepare("UPDATE agent_runs SET status='failed', completed_at=?, failure_code=?, failure_message=? WHERE id=? AND user_id=?").run(isoNow(), normalized.code, normalized.message, analysisId, userId);
    failureDb.close();
    persistSseEvent({ analysisId, type: "agent.failed", payload: { code: normalized.code, retryable: normalized.retryable } });
    throw normalized;
  }
}

export function syncPortfolioFromHoldings(userId: string, portfolioId: string) {
  const previous = getLatestSnapshot(userId);
  const db = getDatabase();
  const holdings = db.prepare(`SELECT h.*,
      COALESCE((SELECT hs.price_decimal FROM holding_snapshots hs
        JOIN portfolio_snapshots ps ON ps.id = hs.portfolio_snapshot_id
        WHERE ps.user_id = h.user_id AND ps.portfolio_id = h.portfolio_id AND hs.instrument_id = h.instrument_id
        ORDER BY ps.created_at DESC, hs.created_at DESC LIMIT 1), h.cost_decimal) AS market_price
    FROM holdings h
    WHERE h.user_id = ? AND h.portfolio_id = ? AND h.status = 'active'`).all(userId, portfolioId) as HoldingRow[];
  const now = isoNow();
  const values = holdings.map((holding) => {
    const quantity = financialDecimal(holding.quantity_decimal);
    const cost = financialDecimal(holding.cost_decimal);
    const price = financialDecimal(holding.market_price ?? cost);
    const marketValue = quantity.mul(price);
    return {
      instrumentId: String(holding.instrument_id),
      quantity: financialString(quantity),
      cost: financialString(cost),
      price: financialString(price),
      marketValue: financialString(marketValue),
      pnl: financialString(price.minus(cost).mul(quantity)),
    };
  });
  const totalMarketValue = values.reduce((sum, value) => sum.plus(value.marketValue), new Decimal(0));
  const snapshotId = createId("portfolio_snapshot");
  const scoreInputs = values.map((value) => ({ instrumentId: value.instrumentId, quantity: value.quantity, price: value.price, marketValue: value.marketValue, weightBps: weightBps(value.marketValue, totalMarketValue) }));
  const score = calculatePortfolioScore(financialString(totalMarketValue), scoreInputs);
  const publish = db.transaction(() => {
    db.prepare("INSERT INTO portfolio_snapshots (id,user_id,portfolio_id,cash_decimal,total_market_value_decimal,data_quality,source_statuses_json,as_of,created_at) VALUES (?,?,?,?,?,'partial',?,?,?)").run(snapshotId, userId, portfolioId, previous?.cash_decimal ?? "0", financialString(totalMarketValue), json([{ source: "USER_HOLDINGS", status: "SUCCEEDED" }, { source: "PREVIOUS_SNAPSHOT", status: "FALLBACK" }]), now, now);
    for (const value of values) db.prepare(`INSERT INTO holding_snapshots
      (id,portfolio_snapshot_id,instrument_id,quantity_decimal,cost_decimal,price_decimal,market_value_decimal,unrealized_pnl_decimal,weight_bps,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(createId("holding_snapshot"), snapshotId, value.instrumentId, value.quantity, value.cost, value.price, value.marketValue, value.pnl, weightBps(value.marketValue, totalMarketValue), now);
    persistScore(db, snapshotId, score);
  });
  publish();
  db.close();
  return { snapshotId, asOf: now };
}

async function fetchLatestPrices(holdings: RefreshHolding[], analysisId: string) {
  const grouped = new Map<PandaDataMethod, Set<string>>();
  for (const holding of holdings) {
    const method = marketMethod(holding);
    const symbols = grouped.get(method) ?? new Set<string>();
    symbols.add(holding.symbol);
    grouped.set(method, symbols);
  }
  const endDate = compactDate(new Date());
  const startDateValue = new Date();
  startDateValue.setUTCDate(startDateValue.getUTCDate() - 35);
  const startDate = compactDate(startDateValue);
  const prices = new Map<string, PricePoint>();
  const statuses: SourceStatus[] = [];
  let successfulSources = 0;
  let firstError: ExtensionError | null = null;

  const db = getDatabase();
  for (const [method, symbols] of grouped.entries()) {
    try {
      const source: PandaQuerySource = {
        dataset: datasetForMethod(method),
        method,
        parameters: { symbol: Array.from(symbols), start_date: startDate, end_date: endDate, fields: ["symbol", "date", "close"] },
        columns: ["symbol", "date", "close"],
        joinKeys: ["symbol", "date"],
        assetType: assetTypeForMethod(method),
      };
      const [execution] = await executePandaSources({ sources: [source], agentRunId: analysisId, localRows: [], db });
      const result = execution.result;
      const rows = normalizePriceRows(result.data);
      for (const row of rows) {
        const current = prices.get(row.symbol);
        if (!current || row.date > current.date) prices.set(row.symbol, row);
      }
      successfulSources += 1;
      statuses.push({ source: `PANDADATA:${method}`, status: "SUCCEEDED", resultCount: rows.length });
    } catch (error) {
      const normalized = normalizeExtensionError(error);
      firstError ??= normalized;
      statuses.push({ source: `PANDADATA:${method}`, status: "FAILED", error: { code: normalized.code, message: normalized.message, retryable: normalized.retryable } });
    }
  }
  db.close();
  return { prices, statuses, successfulSources, firstError };
}

function datasetForMethod(method: PandaDataMethod): MarketDatasetKey {
  if (method === "get_fund_daily") return "MARKET_FUND_DAILY";
  if (method === "get_index_daily") return "MARKET_INDEX_DAILY";
  if (method === "get_hk_daily") return "MARKET_HK_DAILY";
  if (method === "get_us_daily") return "MARKET_US_DAILY";
  return "MARKET_STOCK_DAILY";
}

function assetTypeForMethod(method: PandaDataMethod): string {
  if (method === "get_fund_daily") return "FUND";
  if (method === "get_index_daily") return "INDEX";
  return "STOCK";
}

function marketMethod(holding: RefreshHolding): PandaDataMethod {
  const market = holding.market.toUpperCase();
  const assetType = holding.asset_type.toLowerCase();
  if (market.includes("HK") || holding.symbol.toUpperCase().endsWith(".HK")) return "get_hk_daily";
  if (holding.symbol.toUpperCase().endsWith(".SH") || holding.symbol.toUpperCase().endsWith(".SZ") || market === "SH" || market === "SZ") {
    if (assetType === "fund" || assetType === "etf") return "get_fund_daily";
    if (assetType === "index") return "get_index_daily";
    return "get_stock_daily";
  }
  return "get_us_daily";
}

function normalizePriceRows(data: unknown): PricePoint[] {
  const rows = Array.isArray(data) ? data : data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data) ? (data as { data: unknown[] }).data : [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const value = row as Record<string, unknown>;
    const symbol = String(value.symbol ?? "").trim();
    const date = String(value.date ?? "").trim();
    const close = safeFinancialDecimal(value.close);
    return symbol && date && close?.gt(0) ? [{ symbol, date, close: financialString(close) }] : [];
  });
}

function persistScore(db: ReturnType<typeof getDatabase>, snapshotId: string, score: ReturnType<typeof calculatePortfolioScore>) {
  const now = isoNow();
  db.prepare(`INSERT INTO portfolio_score_snapshots (id, portfolio_snapshot_id, health_score, risk_score, score_version, components_json, missing_metrics_json, computed_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(portfolio_snapshot_id) DO UPDATE SET health_score=excluded.health_score, risk_score=excluded.risk_score, components_json=excluded.components_json, missing_metrics_json=excluded.missing_metrics_json, computed_at=excluded.computed_at`)
    .run(createId("score"), snapshotId, score.healthScore, score.riskScore, score.scoreVersion, json(score.components), json(score.missingMetrics), now, now);
}

function compactDate(value: Date): string {
  return value.toISOString().slice(0, 10).replaceAll("-", "");
}

function normalizeExtensionError(error: unknown): ExtensionError {
  if (error && typeof error === "object" && "code" in error && "message" in error && "retryable" in error) return error as ExtensionError;
  return createExtensionError(ExtensionErrorCode.PANDA_DATA_UNAVAILABLE, error instanceof Error ? error.message : "Portfolio refresh failed", undefined, true);
}

function safeFinancialDecimal(value: unknown): Decimal | null {
  try {
    return financialDecimal(value);
  } catch {
    return null;
  }
}

function financialDecimal(value: unknown): Decimal {
  if (value === null || value === undefined || value === "") throw new Error("INVALID_FINANCIAL_DECIMAL");
  const result = new Decimal(String(value));
  if (!result.isFinite()) throw new Error("INVALID_FINANCIAL_DECIMAL");
  return result;
}

function financialString(value: Decimal): string {
  return value.toDecimalPlaces(12).toFixed().replace(/\.0+$/u, "").replace(/(\.\d*?)0+$/u, "$1");
}

function decimalDisplay(value: Decimal): number {
  return value.toDecimalPlaces(8).toNumber();
}

function weightBps(marketValue: string, totalMarketValue: Decimal): number {
  return totalMarketValue.gt(0)
    ? financialDecimal(marketValue).div(totalMarketValue).mul(10_000).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()
    : 0;
}
