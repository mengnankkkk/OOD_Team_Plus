import { createExtensionError, ExtensionErrorCode, type ExtensionError } from "@/server/extensions/errors/codes";
import { callPandaData, type PandaDataMethod } from "@/server/extensions/pandadata/adapter";
import { persistSseEvent } from "@/server/extensions/sse/event-persister";
import { createId, getDatabase, isoNow, json, parseJson } from "@/server/http/context";

import { calculatePortfolioScore, type HoldingSnapshot } from "./scoring";

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
  close: number;
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
  const rows = db.prepare(`SELECT h.*, i.symbol, i.name, i.asset_type, i.market, i.sector
    FROM holding_snapshots h LEFT JOIN instruments i ON i.id = h.instrument_id
    WHERE h.portfolio_snapshot_id = ? ORDER BY CAST(h.market_value_decimal AS REAL) DESC`).all(snapshot.id) as HoldingRow[];
  db.close();
  const items = rows.map((row) => ({ holdingId: row.id, instrumentId: row.instrument_id, assetType: String(row.asset_type ?? "stock").toUpperCase(), symbol: row.symbol, name: row.name, quantity: row.quantity_decimal, averageCost: row.cost_decimal, marketPrice: row.price_decimal, marketValue: row.market_value_decimal, weight: Number(row.weight_bps ?? 0) / 10_000, unrealizedPnl: row.unrealized_pnl_decimal, unrealizedPnlRate: Number(row.cost_decimal) ? Number(row.unrealized_pnl_decimal) / (Number(row.cost_decimal) * Number(row.quantity_decimal)) : null, drawdown: null, drawdownWindowDays: null, sector: row.sector }));
  const totalValue = items.reduce((sum, item) => sum + Number(item.marketValue), 0);
  const totalPnl = items.reduce((sum, item) => sum + Number(item.unrealizedPnl), 0);
  return {
    portfolioSnapshotId: snapshot.id,
    asOf: snapshot.as_of,
    dataQuality: String(snapshot.data_quality ?? "complete").toUpperCase(),
    sourceStatuses: parseJson(String(snapshot.source_statuses_json ?? "[]"), []),
    summary: { totalValue: totalValue.toFixed(2), cashValue: String(snapshot.cash_decimal), unrealizedPnl: totalPnl.toFixed(2) },
    items,
  };
}

export function getPortfolioMetrics(userId: string, snapshotId?: string) {
  const snapshot = getLatestSnapshot(userId, snapshotId);
  if (!snapshot) return null;
  const view = getPortfolioHoldings(userId, String(snapshot.id));
  const holdings: HoldingSnapshot[] = (view?.items ?? []).map((item) => ({ instrumentId: String(item.instrumentId), quantity: String(item.quantity), price: String(item.marketPrice), marketValue: String(item.marketValue), weightBps: Math.round(item.weight * 10_000) }));
  const score = calculatePortfolioScore(Number(view?.summary.totalValue ?? 0), holdings);
  const db = getDatabase();
  persistScore(db, String(snapshot.id), score);
  db.close();
  return { portfolioSnapshotId: snapshot.id, scoreVersion: score.scoreVersion, healthScore: score.healthScore, riskScore: score.riskScore, metrics: { totalValue: Number(view?.summary.totalValue ?? 0), unrealizedPnl: Number(view?.summary.unrealizedPnl ?? 0), concentrationHhi: score.components.concentrationScore }, components: Object.entries(score.components).map(([code, value]) => ({ code: code.toUpperCase(), score: value, quality: "VALID" })), missingMetrics: score.missingMetrics, dataQuality: view?.dataQuality, sourceStatuses: view?.sourceStatuses, asOf: snapshot.as_of };
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
    const marketData = await fetchLatestPrices(holdings);
    if (marketData.successfulSources === 0) {
      throw marketData.firstError ?? createExtensionError(ExtensionErrorCode.PANDA_DATA_UNAVAILABLE, "No market data source returned successfully", undefined, true);
    }

    const values = holdings.map((holding) => {
      const quote = marketData.prices.get(holding.symbol);
      const fallbackPrice = Number(holding.previous_price ?? holding.cost_decimal);
      const price = quote?.close ?? fallbackPrice;
      const quantity = Number(holding.quantity_decimal);
      const cost = Number(holding.cost_decimal);
      const marketValue = quantity * price;
      return { instrumentId: holding.instrument_id, symbol: holding.symbol, quantity: holding.quantity_decimal, cost: holding.cost_decimal, price, marketValue, pnl: (price - cost) * quantity, usedFallback: !quote };
    });
    const missingSymbols = values.filter((value) => value.usedFallback).map((value) => value.symbol);
    const sourceStatuses = [...marketData.statuses];
    if (missingSymbols.length) sourceStatuses.push({ source: "PREVIOUS_SNAPSHOT", status: "FALLBACK", resultCount: missingSymbols.length });
    const dataQuality = missingSymbols.length || sourceStatuses.some((source) => source.status === "FAILED") ? "partial" : "complete";
    const totalMarketValue = values.reduce((sum, value) => sum + value.marketValue, 0);
    const snapshotId = createId("portfolio_snapshot");
    const publishedAt = isoNow();
    const publishDb = getDatabase();
    const scoreInputs = values.map((value) => ({ instrumentId: value.instrumentId, quantity: String(value.quantity), price: String(value.price), marketValue: String(value.marketValue), weightBps: totalMarketValue ? Math.round(value.marketValue / totalMarketValue * 10_000) : 0 }));
    const score = calculatePortfolioScore(totalMarketValue, scoreInputs);
    const publish = publishDb.transaction(() => {
      publishDb.prepare("INSERT INTO portfolio_snapshots (id,user_id,portfolio_id,cash_decimal,total_market_value_decimal,data_quality,source_statuses_json,as_of,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(snapshotId, userId, portfolioId, previous.cash_decimal, String(totalMarketValue), dataQuality, json(sourceStatuses), publishedAt, publishedAt);
      for (const value of values) {
        publishDb.prepare(`INSERT INTO holding_snapshots
          (id,portfolio_snapshot_id,instrument_id,quantity_decimal,cost_decimal,price_decimal,market_value_decimal,unrealized_pnl_decimal,weight_bps,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(createId("holding_snapshot"), snapshotId, value.instrumentId, value.quantity, value.cost, String(value.price), String(value.marketValue), String(value.pnl), totalMarketValue ? Math.round(value.marketValue / totalMarketValue * 10_000) : 0, publishedAt);
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
    const quantity = Number(holding.quantity_decimal);
    const cost = Number(holding.cost_decimal);
    const price = Number(holding.market_price ?? cost);
    const marketValue = quantity * price;
    return { instrumentId: String(holding.instrument_id), quantity: String(holding.quantity_decimal), cost: String(holding.cost_decimal), price, marketValue, pnl: (price - cost) * quantity };
  });
  const totalMarketValue = values.reduce((sum, value) => sum + value.marketValue, 0);
  const snapshotId = createId("portfolio_snapshot");
  const scoreInputs = values.map((value) => ({ instrumentId: value.instrumentId, quantity: value.quantity, price: String(value.price), marketValue: String(value.marketValue), weightBps: totalMarketValue ? Math.round(value.marketValue / totalMarketValue * 10_000) : 0 }));
  const score = calculatePortfolioScore(totalMarketValue, scoreInputs);
  const publish = db.transaction(() => {
    db.prepare("INSERT INTO portfolio_snapshots (id,user_id,portfolio_id,cash_decimal,total_market_value_decimal,data_quality,source_statuses_json,as_of,created_at) VALUES (?,?,?,?,?,'partial',?,?,?)").run(snapshotId, userId, portfolioId, previous?.cash_decimal ?? "0", String(totalMarketValue), json([{ source: "USER_HOLDINGS", status: "SUCCEEDED" }, { source: "PREVIOUS_SNAPSHOT", status: "FALLBACK" }]), now, now);
    for (const value of values) db.prepare(`INSERT INTO holding_snapshots
      (id,portfolio_snapshot_id,instrument_id,quantity_decimal,cost_decimal,price_decimal,market_value_decimal,unrealized_pnl_decimal,weight_bps,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(createId("holding_snapshot"), snapshotId, value.instrumentId, value.quantity, value.cost, String(value.price), String(value.marketValue), String(value.pnl), totalMarketValue ? Math.round(value.marketValue / totalMarketValue * 10_000) : 0, now);
    persistScore(db, snapshotId, score);
  });
  publish();
  db.close();
  return { snapshotId, asOf: now };
}

async function fetchLatestPrices(holdings: RefreshHolding[]) {
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

  await Promise.all(Array.from(grouped.entries()).map(async ([method, symbols]) => {
    try {
      const result = await callPandaData(method, { symbol: Array.from(symbols), start_date: startDate, end_date: endDate, fields: ["symbol", "date", "close"] });
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
  }));
  return { prices, statuses, successfulSources, firstError };
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
    const close = Number(value.close);
    return symbol && date && Number.isFinite(close) && close > 0 ? [{ symbol, date, close }] : [];
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
