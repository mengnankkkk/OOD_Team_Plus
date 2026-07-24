import { NextRequest, NextResponse } from "next/server";

import { formatRecommendation } from "@/server/extensions/advisor/recommendations";
import { getSseEvents } from "@/server/extensions/sse/event-persister";
import { getDatabase, getRequestContext, meta, parseJson } from "@/server/http/context";

type Row = Record<string, unknown>;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = getRequestContext(req);
  const includeToolPayload = req.nextUrl.searchParams.get("includeToolPayload") === "true";
  const db = getDatabase();
  const run = db.prepare("SELECT * FROM agent_runs WHERE id=? AND user_id=?").get(id, userId) as Row | undefined;
  if (!run) {
    db.close();
    return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Analysis not found" } }, { status: 404 });
  }

  const agentRuns = db.prepare(`SELECT * FROM agent_runs
    WHERE user_id=? AND (id=? OR root_run_id=?) ORDER BY created_at,id`).all(userId, id, id) as Row[];
  const toolCalls = db.prepare(`SELECT tc.*,ds.code AS source_code,ds.name AS source_name
    FROM tool_calls tc JOIN agent_runs ar ON ar.id=tc.agent_run_id
    LEFT JOIN data_sources ds ON ds.id=tc.data_source_id
    WHERE ar.user_id=? AND (ar.id=? OR ar.root_run_id=?) ORDER BY tc.created_at,tc.id`).all(userId, id, id) as Row[];
  const skillRuns = db.prepare(`SELECT sr.*,sa.slug AS skill_slug,sa.version AS skill_version,sa.validation_level,sa.license,
      ds.code AS source_code,ds.name AS source_name
    FROM skill_runs sr JOIN agent_runs ar ON ar.id=sr.agent_run_id
    JOIN skill_assets sa ON sa.id=sr.skill_asset_id
    LEFT JOIN data_sources ds ON ds.id=sr.data_source_id
    WHERE ar.user_id=? AND (ar.id=? OR ar.root_run_id=?) ORDER BY sr.created_at,sr.id`).all(userId, id, id) as Row[];
  const pandadataProbes = db.prepare(`SELECT pp.* FROM pandadata_probes pp
    JOIN agent_runs ar ON ar.id=pp.agent_run_id
    WHERE ar.user_id=? AND (ar.id=? OR ar.root_run_id=?) ORDER BY pp.created_at,pp.id`).all(userId, id, id) as Row[];
  const recommendations = db.prepare("SELECT * FROM recommendations WHERE analysis_id=? AND user_id=? ORDER BY created_at,id")
    .all(id, userId) as Row[];
  const evidence = db.prepare(`SELECT ei.* FROM evidence_items ei JOIN agent_runs ar ON ar.id=ei.agent_run_id
    WHERE ei.user_id=? AND (ar.id=? OR ar.root_run_id=?) ORDER BY ei.created_at,ei.id`).all(userId, id, id) as Row[];
  const evidenceLinks = evidence.length ? db.prepare(`SELECT esl.*,ds.code AS source_code,ds.name AS source_name,
      ms.as_of AS snapshot_as_of,ms.freshness_status,ms.quality_status AS snapshot_quality,ms.source_method,
      msm.metric_code AS linked_metric_code,msm.value_decimal AS linked_value_decimal,msm.value_text AS linked_value_text
    FROM evidence_source_links esl JOIN data_sources ds ON ds.id=esl.data_source_id
    LEFT JOIN market_snapshots ms ON ms.id=esl.market_snapshot_id
    LEFT JOIN market_snapshot_metrics msm ON msm.id=esl.market_snapshot_metric_id
    WHERE esl.evidence_id IN (${evidence.map(() => "?").join(",")}) ORDER BY esl.created_at,esl.id`)
    .all(...evidence.map((item) => item.id)) as Row[] : [];
  const snapshotIds = [...new Set(evidenceLinks.map((item) => item.market_snapshot_id).filter(Boolean))];
  const marketSnapshots = snapshotIds.length ? db.prepare(`SELECT ms.*,i.symbol,i.name AS instrument_name,ds.code AS source_code,ds.name AS source_name
    FROM market_snapshots ms JOIN instruments i ON i.id=ms.instrument_id JOIN data_sources ds ON ds.id=ms.data_source_id
    WHERE ms.id IN (${snapshotIds.map(() => "?").join(",")}) ORDER BY ms.as_of,ms.id`).all(...snapshotIds) as Row[] : [];
  const conflicts = db.prepare("SELECT * FROM agent_conflicts WHERE root_run_id=? ORDER BY created_at,id").all(id) as Row[];
  db.close();

  const linksByEvidence = new Map<string, Row[]>();
  for (const link of evidenceLinks) {
    const evidenceId = String(link.evidence_id);
    linksByEvidence.set(evidenceId, [...(linksByEvidence.get(evidenceId) ?? []), link]);
  }
  const missingEvidence = buildMissingEvidence({ evidence, toolCalls, skillRuns, marketSnapshots, recommendations, conflicts });

  return NextResponse.json({
    data: {
      analysisId: id,
      analysis: {
        analysisId: id,
        type: String(run.type).toUpperCase(),
        status: String(run.status).toUpperCase(),
        createdAt: run.created_at,
        completedAt: run.completed_at,
      },
      dataFreshness: summarizeFreshness(marketSnapshots, skillRuns),
      evidence: evidence.map((item) => ({
        id: item.id,
        category: String(item.kind).toUpperCase(),
        stance: String(item.stance).toUpperCase(),
        title: item.title,
        summary: item.statement ?? item.summary,
        quality: String(item.quality).toUpperCase(),
        dataAsOf: item.observed_at ?? null,
        confidenceBps: item.confidence_bps ?? null,
        sources: (linksByEvidence.get(String(item.id)) ?? []).map(formatEvidenceSource),
      })),
      agentTrace: agentRuns.map((item) => ({
        id: item.id,
        parentRunId: item.parent_run_id ?? null,
        agent: String(item.agent_type ?? item.type).toUpperCase(),
        status: String(item.status).toUpperCase(),
        purpose: item.objective ?? null,
        summary: item.output_summary ?? null,
        modelProvider: item.model_provider ?? null,
        modelName: item.model_name ?? null,
        startedAt: item.started_at ?? item.created_at,
        completedAt: item.completed_at ?? null,
        failure: item.failure_code ? { code: item.failure_code, message: item.failure_message } : null,
      })),
      toolCalls: toolCalls.map((item) => ({
        id: item.id,
        agentRunId: item.agent_run_id,
        toolName: item.tool_name,
        toolVersion: item.tool_version,
        status: String(item.status).toUpperCase(),
        source: { code: item.source_code ?? null, name: item.source_name ?? null },
        outputSummary: item.result_summary ?? null,
        error: item.error_code ? { code: item.error_code, message: item.error_message } : null,
        startedAt: item.started_at,
        completedAt: item.completed_at,
        ...(includeToolPayload ? {
          input: sanitizePayload(parseJson(String(item.arguments_json ?? "{}"), {})),
          result: sanitizePayload(parseJson(String(item.result_json ?? "{}"), {})),
        } : {}),
      })),
      skillRuns: skillRuns.map((item) => ({
        id: item.id,
        agentRunId: item.agent_run_id,
        toolCallId: item.tool_call_id,
        skill: { slug: item.skill_slug, version: item.skill_version, validationLevel: item.validation_level, license: item.license },
        method: item.method_name,
        status: String(item.status).toUpperCase(),
        quality: String(item.quality_status).toUpperCase(),
        dataAsOf: item.data_as_of,
        freshUntil: item.fresh_until,
        outputSummary: item.output_summary,
        error: item.error_code ? { code: item.error_code, message: item.error_message } : null,
      })),
      pandadataProbes: pandadataProbes.map((item) => ({
        id: item.id,
        agentRunId: item.agent_run_id,
        toolCallId: item.tool_call_id,
        skillRunId: item.skill_run_id,
        method: item.method_name,
        phase: String(item.phase).toUpperCase(),
        status: String(item.status).toUpperCase(),
        durationMs: item.duration_ms,
        dataAsOf: item.data_as_of,
        freshness: item.freshness_status ? String(item.freshness_status).toUpperCase() : null,
        error: item.error_category ? { category: item.error_category, message: item.error_message } : null,
      })),
      marketSnapshots: marketSnapshots.map((item) => ({
        id: item.id,
        instrument: { symbol: item.symbol, name: item.instrument_name },
        source: { code: item.source_code, name: item.source_name, method: item.source_method },
        asOf: item.as_of,
        tradingDate: item.trading_date,
        freshness: String(item.freshness_status).toUpperCase(),
        quality: String(item.quality_status).toUpperCase(),
      })),
      conflicts: conflicts.map((item) => ({
        id: item.id,
        type: item.conflict_type,
        summary: item.summary,
        status: String(item.resolution_status).toUpperCase(),
        resolution: item.resolution_text ?? null,
        createdAt: item.created_at,
        resolvedAt: item.resolved_at ?? null,
      })),
      recommendations: recommendations.map(formatRecommendation),
      compliance: parseJson(String(run.compliance_json ?? "{}"), {}),
      result: parseJson(String(run.result_json ?? "{}"), {}),
      events: getSseEvents(id).map((event) => ({ id: event.id, type: event.type, payload: event.payload, createdAt: event.createdAt })),
      missingEvidence,
      disclaimer: "证据包用于解释模拟建议，不代表未来收益，不包含隐藏思维链或敏感凭证。",
    },
    meta: meta(),
  });
}

function formatEvidenceSource(item: Row) {
  return {
    type: String(item.source_code ?? "UNKNOWN").toUpperCase(),
    name: item.source_name,
    reference: item.source_locator ?? null,
    toolCallId: item.tool_call_id ?? null,
    marketSnapshotId: item.market_snapshot_id ?? null,
    dataAsOf: item.snapshot_as_of ?? null,
    freshness: item.freshness_status ? String(item.freshness_status).toUpperCase() : null,
    metric: item.linked_metric_code ? {
      code: item.linked_metric_code,
      value: item.linked_value_decimal ?? item.linked_value_text,
    } : null,
    excerpt: item.excerpt ?? null,
  };
}

function summarizeFreshness(snapshots: Row[], skillRuns: Row[]) {
  const dates = snapshots.map((item) => String(item.as_of ?? "")).filter(Boolean).sort();
  const hasStale = snapshots.some((item) => String(item.freshness_status).toLowerCase() === "stale")
    || skillRuns.some((item) => String(item.quality_status).toLowerCase() === "stale");
  const hasFailed = skillRuns.some((item) => String(item.status).toLowerCase() === "failed");
  return {
    marketDataAsOf: dates.at(-1) ?? null,
    financialReportPeriod: null,
    status: snapshots.length ? hasStale ? "STALE" : "FRESH" : hasFailed ? "UNAVAILABLE" : "NOT_REQUIRED",
  };
}

function buildMissingEvidence(input: { evidence: Row[]; toolCalls: Row[]; skillRuns: Row[]; marketSnapshots: Row[]; recommendations: Row[]; conflicts: Row[] }): string[] {
  const missing: string[] = [];
  if (!input.evidence.length) missing.push("该分析尚未写入结构化证据。");
  if (!input.evidence.some((item) => String(item.stance).toLowerCase() === "counter")) missing.push("缺少反方证据。");
  if (input.toolCalls.length && !input.skillRuns.length) missing.push("工具调用没有关联 Skill Run。");
  if (input.skillRuns.some((item) => String(item.status).toLowerCase() === "succeeded") && !input.marketSnapshots.length) missing.push("成功的数据 Skill 没有关联市场快照。");
  if (!input.recommendations.length) missing.push("该分析没有生成建议卡。");
  if (input.conflicts.some((item) => String(item.resolution_status).toLowerCase() === "unresolved")) missing.push("仍存在未解决的 Agent 冲突。");
  return missing;
}

function sanitizePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 100).map(sanitizePayload);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    /token|password|secret|api[_-]?key|authorization|cookie/iu.test(key) ? "[REDACTED]" : sanitizePayload(item),
  ]));
}
