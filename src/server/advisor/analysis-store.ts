import type { AdvisorDatabase } from "@/server/advisor/database";
import { json, newId, nowIso, parseJson, runRows, runValue, runWrite } from "@/server/advisor/store-common";
import type { RecommendationCard } from "@/server/advisor/types";

export type MarketSnapshotRecord = {
  id: string;
  instrumentId: string;
  sourceType: string;
  sourceMethod: string | null;
  dataAsOf: string | null;
  freshUntil: string | null;
  quality: string;
  rows: number;
  data: Array<Record<string, unknown>>;
  metrics: Record<string, unknown>;
};

export type PortfolioSnapshotRecord = {
  id: string;
  userId: string;
  reason: string;
  asOf: string;
  totalValueMinor: number;
  cashValueMinor: number;
  investedValueMinor: number;
  totalCostMinor: number;
  unrealizedPnlMinor: number;
  currentDrawdown: number;
  dataQuality: string;
  details: Record<string, unknown>;
};

export class AnalysisStore {
  constructor(private readonly database: AdvisorDatabase) {}

  saveMarketSnapshot(input: Omit<MarketSnapshotRecord, "id">) {
    const id = newId("market");
    runWrite(
      this.database,
      `INSERT INTO market_snapshots
       (id, instrument_id, source_type, source_method, data_as_of, fresh_until, quality, rows, data_json, metrics_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.instrumentId,
      input.sourceType,
      input.sourceMethod,
      input.dataAsOf,
      input.freshUntil,
      input.quality,
      input.rows,
      json(input.data),
      json(input.metrics),
      nowIso(),
    );
    return { ...input, id };
  }

  getLatestMarketSnapshot(instrumentId: string) {
    const row = runValue<Record<string, unknown>>(
      this.database,
      "SELECT * FROM market_snapshots WHERE instrument_id = ? ORDER BY created_at DESC LIMIT 1",
      instrumentId,
    );
    return row ? mapMarket(row) : null;
  }

  savePortfolioSnapshot(input: Omit<PortfolioSnapshotRecord, "id">) {
    const id = newId("portfolio");
    runWrite(
      this.database,
      `INSERT INTO portfolio_snapshots
       (id, user_id, reason, as_of, total_value_minor, cash_value_minor, invested_value_minor,
        total_cost_minor, unrealized_pnl_minor, current_drawdown, data_quality, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.userId,
      input.reason,
      input.asOf,
      input.totalValueMinor,
      input.cashValueMinor,
      input.investedValueMinor,
      input.totalCostMinor,
      input.unrealizedPnlMinor,
      input.currentDrawdown,
      input.dataQuality,
      json(input.details),
      nowIso(),
    );
    return { ...input, id };
  }

  getPortfolioSnapshot(snapshotId: string) {
    const row = runValue<Record<string, unknown>>(
      this.database,
      "SELECT * FROM portfolio_snapshots WHERE id = ?",
      snapshotId,
    );
    return row ? mapPortfolio(row) : null;
  }

  saveDiagnostic(input: {
    userId: string;
    analysisId: string;
    type: string;
    status: string;
    portfolioSnapshotId?: string;
    details: Record<string, unknown>;
  }) {
    const id = newId("diagnostic");
    const timestamp = nowIso();
    runWrite(
      this.database,
      `INSERT INTO diagnostic_runs
       (id, user_id, analysis_id, type, status, portfolio_snapshot_id, details_json, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.userId,
      input.analysisId,
      input.type,
      input.status,
      input.portfolioSnapshotId ?? null,
      json(input.details),
      timestamp,
      timestamp,
    );
    return { id, ...input, completedAt: timestamp };
  }

  getDiagnosticByAnalysis(analysisId: string) {
    const row = runValue<Record<string, unknown>>(
      this.database,
      "SELECT * FROM diagnostic_runs WHERE analysis_id = ? ORDER BY created_at DESC LIMIT 1",
      analysisId,
    );
    return row
      ? {
          id: String(row.id),
          analysisId: String(row.analysis_id),
          type: String(row.type),
          status: String(row.status).toUpperCase(),
          portfolioSnapshotId: row.portfolio_snapshot_id as string | null,
          details: parseJson<Record<string, unknown>>(row.details_json, {}),
        }
      : null;
  }

  saveRecommendation(input: Omit<RecommendationCard, "id" | "createdAt">) {
    const id = newId("recommendation");
    const createdAt = nowIso();
    const details = { ...input, id, createdAt };
    runWrite(
      this.database,
      `INSERT INTO recommendations
       (id, user_id, analysis_id, portfolio_snapshot_id, instrument_id, action, status,
        summary, suitability, confidence, valid_until, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.userId ?? "user_demo_01",
      input.analysisId,
      (input as Record<string, unknown>).portfolioSnapshotId ?? null,
      (input as Record<string, unknown>).instrumentId ?? null,
      input.action,
      input.status,
      input.summary,
      input.suitability,
      input.confidence,
      input.validUntil,
      json(details),
      createdAt,
    );
    return details as RecommendationCard;
  }

  getRecommendation(id: string) {
    const row = runValue<{ details_json: string }>(
      this.database,
      "SELECT details_json FROM recommendations WHERE id = ?",
      id,
    );
    return row ? parseJson<RecommendationCard | null>(row.details_json, null) : null;
  }

  getRecommendationForAnalysis(analysisId: string) {
    const row = runValue<{ details_json: string }>(
      this.database,
      "SELECT details_json FROM recommendations WHERE analysis_id = ? ORDER BY created_at DESC LIMIT 1",
      analysisId,
    );
    return row ? parseJson<RecommendationCard | null>(row.details_json, null) : null;
  }

  listRecommendations(userId: string, filters: { action?: string; status?: string } = {}) {
    const clauses = ["user_id = ?"];
    const params: unknown[] = [userId];
    if (filters.action) {
      clauses.push("action = ?");
      params.push(filters.action);
    }
    if (filters.status) {
      clauses.push("status = ?");
      params.push(filters.status);
    }
    return runRows<{ details_json: string }>(
      this.database,
      `SELECT details_json FROM recommendations WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`,
      ...params,
    ).map((row) => parseJson<RecommendationCard>(row.details_json, {} as RecommendationCard));
  }

  deleteUserAnalysisData(userId: string) {
    runWrite(this.database, "DELETE FROM recommendations WHERE user_id = ?", userId);
    runWrite(this.database, "DELETE FROM diagnostic_runs WHERE user_id = ?", userId);
    runWrite(this.database, "DELETE FROM portfolio_snapshots WHERE user_id = ?", userId);
  }
}

function mapMarket(row: Record<string, unknown>): MarketSnapshotRecord {
  return {
    id: String(row.id),
    instrumentId: String(row.instrument_id),
    sourceType: String(row.source_type),
    sourceMethod: row.source_method as string | null,
    dataAsOf: row.data_as_of as string | null,
    freshUntil: row.fresh_until as string | null,
    quality: String(row.quality),
    rows: Number(row.rows),
    data: parseJson(row.data_json, []),
    metrics: parseJson(row.metrics_json, {}),
  };
}

function mapPortfolio(row: Record<string, unknown>): PortfolioSnapshotRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    reason: String(row.reason),
    asOf: String(row.as_of),
    totalValueMinor: Number(row.total_value_minor),
    cashValueMinor: Number(row.cash_value_minor),
    investedValueMinor: Number(row.invested_value_minor),
    totalCostMinor: Number(row.total_cost_minor),
    unrealizedPnlMinor: Number(row.unrealized_pnl_minor),
    currentDrawdown: Number(row.current_drawdown ?? 0),
    dataQuality: String(row.data_quality),
    details: parseJson(row.details_json, {}),
  };
}
