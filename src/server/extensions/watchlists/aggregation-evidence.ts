import { parseJson, type getDatabase } from "@/server/http/context";

import type { AgentConclusionAggregate, EventAggregate, ValuationAggregate } from "./types";

type Db = ReturnType<typeof getDatabase>;
type RecommendationRow = { id: string; analysis_id: string | null };
type EvidenceRow = {
  value_text: string | null;
  summary: string;
  statement: string | null;
  source: string;
  observed_at: string | null;
  created_at: string;
};

export function readValuationAggregate(
  db: Db,
  userId: string,
  instrumentId: string,
): ValuationAggregate {
  const recommendation = db.prepare(`SELECT id,analysis_id FROM recommendations
    WHERE user_id = ? AND instrument_id = ? AND lower(status) != 'deleted'
    ORDER BY created_at DESC,id DESC LIMIT 1`)
    .get(userId, instrumentId) as RecommendationRow | undefined;
  if (recommendation) {
    const direct = explicitValuation(db.prepare(`${valuationSelect()}
      AND e.recommendation_id = ? ORDER BY COALESCE(e.observed_at,e.created_at) DESC,e.id DESC`)
      .all(userId, recommendation.id) as EvidenceRow[]);
    if (direct) return direct;
    if (recommendation.analysis_id) {
      const analysis = explicitValuation(db.prepare(`${valuationSelect()}
        AND (e.agent_run_id = ? OR e.agent_run_id IN
          (SELECT id FROM agent_runs WHERE root_run_id = ?))
        ORDER BY COALESCE(e.observed_at,e.created_at) DESC,e.id DESC`)
        .all(userId, recommendation.analysis_id, recommendation.analysis_id) as EvidenceRow[]);
      if (analysis) return analysis;
    }
  }
  return unavailableValuation();
}

export function readRecentEvent(db: Db, instrumentId: string): EventAggregate | null {
  const publishedAfter = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const row = db.prepare(`SELECT ri.id,ri.title,ri.link,ri.published_at,rf.title AS source,rii.match_basis
    FROM rss_item_instruments rii
    JOIN rss_items ri ON ri.id = rii.rss_item_id
    JOIN rss_feeds rf ON rf.id = ri.feed_id
    WHERE rii.instrument_id = ? AND COALESCE(ri.published_at,ri.created_at) >= ?
      AND rf.status = 'active' AND rf.deleted_at IS NULL
    ORDER BY COALESCE(ri.published_at,ri.created_at) DESC,ri.id DESC LIMIT 1`)
    .get(instrumentId, publishedAfter) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    title: String(row.title),
    source: String(row.source),
    canonicalUrl: nullable(row.link),
    publishedAt: nullable(row.published_at),
    matchBasis: String(row.match_basis) as EventAggregate["matchBasis"],
  };
}

export function readLatestAgentConclusion(
  db: Db,
  userId: string,
  instrumentId: string,
): AgentConclusionAggregate | null {
  const row = db.prepare(`SELECT id,action,summary,status,created_at FROM recommendations
    WHERE user_id = ? AND instrument_id = ? AND lower(status) != 'deleted'
    ORDER BY created_at DESC,id DESC LIMIT 1`)
    .get(userId, instrumentId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    recommendationId: String(row.id),
    action: String(row.action),
    summary: nullable(row.summary),
    status: String(row.status),
    createdAt: String(row.created_at),
  };
}

function valuationSelect(): string {
  return `SELECT e.value_text,e.summary,e.statement,e.source,e.observed_at,e.created_at
    FROM evidence_items e WHERE e.user_id = ?
      AND (lower(e.kind) LIKE '%valuation%' OR lower(COALESCE(e.metric_code,'')) IN
        ('valuation','valuation_status','valuation_level'))`;
}

function explicitValuation(rows: EvidenceRow[]): ValuationAggregate | null {
  for (const row of rows) {
    const status = normalizedStatus(row.value_text)
      ?? jsonStatus(row.value_text)
      ?? jsonStatus(row.statement)
      ?? jsonStatus(row.summary);
    if (!status) continue;
    return {
      status,
      label: status === "low" ? "估值偏低" : status === "fair" ? "估值合理" : "估值偏高",
      source: row.source,
      dataAsOf: row.observed_at ?? row.created_at,
    };
  }
  return null;
}

function normalizedStatus(value: unknown): "low" | "fair" | "high" | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "low" || normalized === "fair" || normalized === "high" ? normalized : null;
}

function jsonStatus(value: string | null): "low" | "fair" | "high" | null {
  const parsed = parseJson<Record<string, unknown>>(value, {});
  return normalizedStatus(parsed.valuationStatus ?? parsed.valuation_status ?? parsed.status);
}

function nullable(value: unknown): string | null {
  return value == null ? null : String(value);
}

function unavailableValuation(): ValuationAggregate {
  return { status: "insufficient_data", label: "暂无估值证据", source: null, dataAsOf: null };
}
