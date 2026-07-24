import { getDatabase, createId, isoNow, json } from "@/server/http/context";
import { calculatePortfolioScore, type HoldingSnapshot } from "./scoring";
import { persistSseEvent } from "../sse/event-persister";

type HoldingRow = Record<string, unknown>;

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
    WHERE h.portfolio_snapshot_id = ? ORDER BY h.market_value_decimal DESC`).all(snapshot.id) as HoldingRow[];
  db.close();
  const items = rows.map((row) => ({ holdingId: row.id, instrumentId: row.instrument_id, assetType: String(row.asset_type ?? "stock").toUpperCase(), symbol: row.symbol, name: row.name, quantity: row.quantity_decimal, averageCost: row.cost_decimal, marketPrice: row.price_decimal, marketValue: row.market_value_decimal, weight: Number(row.weight_bps ?? 0) / 10_000, unrealizedPnl: row.unrealized_pnl_decimal, unrealizedPnlRate: Number(row.cost_decimal) ? Number(row.unrealized_pnl_decimal) / (Number(row.cost_decimal) * Number(row.quantity_decimal)) : null, drawdown: null, drawdownWindowDays: null, sector: row.sector }));
  const totalValue = items.reduce((sum, item) => sum + Number(item.marketValue), 0);
  const totalPnl = items.reduce((sum, item) => sum + Number(item.unrealizedPnl), 0);
  return { portfolioSnapshotId: snapshot.id, asOf: snapshot.as_of, dataQuality: "COMPLETE", summary: { totalValue: totalValue.toFixed(2), cashValue: String(snapshot.cash_decimal), unrealizedPnl: totalPnl.toFixed(2) }, items };
}

export function getPortfolioMetrics(userId: string, snapshotId?: string) {
  const snapshot = getLatestSnapshot(userId, snapshotId);
  if (!snapshot) return null;
  const view = getPortfolioHoldings(userId, String(snapshot.id));
  const holdings: HoldingSnapshot[] = (view?.items ?? []).map((item) => ({ instrumentId: String(item.instrumentId), quantity: String(item.quantity), price: String(item.marketPrice), marketValue: String(item.marketValue), weightBps: Math.round(item.weight * 10_000) }));
  const score = calculatePortfolioScore(Number(view?.summary.totalValue ?? 0), holdings);
  const db = getDatabase();
  db.prepare(`INSERT INTO portfolio_score_snapshots (id, portfolio_snapshot_id, health_score, risk_score, score_version, components_json, missing_metrics_json, computed_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(portfolio_snapshot_id) DO UPDATE SET health_score=excluded.health_score, risk_score=excluded.risk_score, components_json=excluded.components_json, missing_metrics_json=excluded.missing_metrics_json, computed_at=excluded.computed_at`)
    .run(createId("score"), snapshot.id, score.healthScore, score.riskScore, score.scoreVersion, json(score.components), json(score.missingMetrics), isoNow(), isoNow());
  db.close();
  return { portfolioSnapshotId: snapshot.id, scoreVersion: score.scoreVersion, healthScore: score.healthScore, riskScore: score.riskScore, metrics: { totalValue: Number(view?.summary.totalValue ?? 0), unrealizedPnl: Number(view?.summary.unrealizedPnl ?? 0), concentrationHhi: score.components.concentrationScore }, components: Object.entries(score.components).map(([code, value]) => ({ code: code.toUpperCase(), score: value, quality: "VALID" })), missingMetrics: score.missingMetrics, asOf: snapshot.as_of };
}

export function refreshPortfolio(userId: string, portfolioId: string) {
  const old = getLatestSnapshot(userId);
  if (!old) throw new Error("Portfolio not found");
  const now = isoNow();
  const analysisId = createId("analysis");
  const snapshotId = createId("portfolio_snapshot");
  const db = getDatabase();
  db.prepare("INSERT INTO agent_runs (id,user_id,type,status,created_at) VALUES (?,?,?,?,?)").run(analysisId, userId, "portfolio_refresh", "running", now);
  db.prepare("INSERT INTO portfolio_snapshots (id, user_id, portfolio_id, cash_decimal, total_market_value_decimal, as_of, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(snapshotId, userId, portfolioId, old.cash_decimal, old.total_market_value_decimal, now, now);
  const rows = db.prepare("SELECT * FROM holding_snapshots WHERE portfolio_snapshot_id = ?").all(old.id) as HoldingRow[];
  for (const row of rows) {
  db.prepare("INSERT INTO holding_snapshots (id, portfolio_snapshot_id, instrument_id, quantity_decimal, cost_decimal, price_decimal, market_value_decimal, unrealized_pnl_decimal, weight_bps, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(createId("holding_snapshot"), snapshotId, row.instrument_id, row.quantity_decimal, row.cost_decimal, row.price_decimal, row.market_value_decimal, row.unrealized_pnl_decimal, row.weight_bps, now);
  }
  db.prepare("UPDATE agent_runs SET status='completed', completed_at=? WHERE id=?").run(isoNow(), analysisId);
  db.close();
  persistSseEvent({ analysisId, type: "portfolio.refreshed", payload: { portfolioSnapshotId: snapshotId } });
  return { snapshotId, analysisId, asOf: now };
}

export function syncPortfolioFromHoldings(userId: string, portfolioId: string) {
  const previous = getLatestSnapshot(userId);
  const db = getDatabase();
  const holdings = db.prepare(`SELECT h.*, COALESCE(latest.price_decimal, h.cost_decimal) AS market_price
    FROM holdings h LEFT JOIN (
      SELECT hs.instrument_id, hs.price_decimal
      FROM holding_snapshots hs JOIN portfolio_snapshots ps ON ps.id = hs.portfolio_snapshot_id
      WHERE ps.user_id = ? ORDER BY ps.created_at DESC
    ) latest ON latest.instrument_id = h.instrument_id
    WHERE h.user_id = ? AND h.portfolio_id = ? AND h.status = 'active'`).all(userId, userId, portfolioId) as HoldingRow[];
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
  db.prepare("INSERT INTO portfolio_snapshots (id,user_id,portfolio_id,cash_decimal,total_market_value_decimal,as_of,created_at) VALUES (?,?,?,?,?,?,?)").run(snapshotId, userId, portfolioId, previous?.cash_decimal ?? "0", String(totalMarketValue), now, now);
  for (const value of values) db.prepare(`INSERT INTO holding_snapshots
    (id,portfolio_snapshot_id,instrument_id,quantity_decimal,cost_decimal,price_decimal,market_value_decimal,unrealized_pnl_decimal,weight_bps,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(createId("holding_snapshot"), snapshotId, value.instrumentId, value.quantity, value.cost, String(value.price), String(value.marketValue), String(value.pnl), totalMarketValue ? Math.round(value.marketValue / totalMarketValue * 10_000) : 0, now);
  db.close();
  return { snapshotId, asOf: now };
}
