import { NextRequest, NextResponse } from "next/server";

import { formatRecommendation } from "@/server/extensions/advisor/recommendations";
import { getSseEvents } from "@/server/extensions/sse/event-persister";
import { getDatabase, getRequestContext, meta, parseJson } from "@/server/http/context";

import { buildMissingEvidence, publicAgentPurpose, sanitizePayload, summarizeFreshness } from "./evidence-pack-format";
import { formatEvidenceSource, resolveEvidenceTime, verifiedDataTime, type EvidenceTime } from "./evidence-time";
import { buildSimulationPreview } from "./simulation-preview";

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
  const evidence = db.prepare(`SELECT ei.*,ar.agent_type AS evidence_agent_type,
      ar.started_at AS evidence_run_started_at,ar.completed_at AS evidence_run_completed_at,
      ar.created_at AS evidence_run_created_at
    FROM evidence_items ei JOIN agent_runs ar ON ar.id=ei.agent_run_id
    WHERE ei.user_id=? AND (ar.id=? OR ar.root_run_id=?) ORDER BY ei.created_at,ei.id`).all(userId, id, id) as Row[];
  const evidenceLinks = evidence.length ? db.prepare(`SELECT esl.*,ds.code AS source_code,ds.name AS source_name,
      ms.as_of AS snapshot_as_of,ms.freshness_status,ms.quality_status AS snapshot_quality,ms.source_method,
      msm.metric_code AS linked_metric_code,msm.value_decimal AS linked_value_decimal,msm.value_text AS linked_value_text,
      linked_sr.data_as_of AS linked_skill_data_as_of,linked_sr.completed_at AS linked_skill_completed_at,
      linked_sr.started_at AS linked_skill_started_at,linked_sr.created_at AS linked_skill_created_at
    FROM evidence_source_links esl LEFT JOIN data_sources ds ON ds.id=esl.data_source_id
    LEFT JOIN market_snapshots ms ON ms.id=esl.market_snapshot_id
    LEFT JOIN market_snapshot_metrics msm ON msm.id=esl.market_snapshot_metric_id
    LEFT JOIN skill_runs linked_sr ON linked_sr.tool_call_id=esl.tool_call_id
    WHERE esl.evidence_id IN (${evidence.map(() => "?").join(",")}) ORDER BY esl.created_at,esl.id`)
    .all(...evidence.map((item) => item.id)) as Row[] : [];
  const snapshotIds = [...new Set(evidenceLinks.map((item) => item.market_snapshot_id).filter(Boolean))];
  const marketSnapshots = snapshotIds.length ? db.prepare(`SELECT ms.*,i.symbol,i.name AS instrument_name,ds.code AS source_code,ds.name AS source_name
    FROM market_snapshots ms JOIN instruments i ON i.id=ms.instrument_id LEFT JOIN data_sources ds ON ds.id=ms.data_source_id
    WHERE ms.id IN (${snapshotIds.map(() => "?").join(",")}) ORDER BY ms.as_of,ms.id`).all(...snapshotIds) as Row[] : [];
  const analysisReferenceAt = String(run.completed_at ?? run.created_at);
  const portfolioSnapshot = db.prepare(`SELECT id,as_of FROM portfolio_snapshots
    WHERE user_id=? AND as_of<=? ORDER BY as_of DESC,created_at DESC LIMIT 1`).get(userId, analysisReferenceAt) as Row | undefined;
  const riskAssessment = db.prepare(`SELECT id,created_at FROM risk_assessments
    WHERE user_id=? AND created_at<=? ORDER BY created_at DESC,id DESC LIMIT 1`).get(userId, analysisReferenceAt) as Row | undefined;
  const profileSnapshot = db.prepare(`SELECT id,created_at,updated_at FROM user_profiles
    WHERE user_id=? AND created_at<=? ORDER BY updated_at DESC,created_at DESC LIMIT 1`).get(userId, analysisReferenceAt) as Row | undefined;
  const simulationPreview = buildSimulationPreview(db, userId, recommendations, analysisReferenceAt, portfolioSnapshot);
  const conflicts = db.prepare("SELECT * FROM agent_conflicts WHERE root_run_id=? ORDER BY created_at,id").all(id) as Row[];
  db.close();

  const linksByEvidence = new Map<string, Row[]>();
  for (const link of evidenceLinks) {
    const evidenceId = String(link.evidence_id);
    linksByEvidence.set(evidenceId, [...(linksByEvidence.get(evidenceId) ?? []), link]);
  }
  const skillRunsByAgent = new Map<string, Row[]>();
  for (const skillRun of skillRuns) {
    const agentRunId = String(skillRun.agent_run_id);
    skillRunsByAgent.set(agentRunId, [...(skillRunsByAgent.get(agentRunId) ?? []), skillRun]);
  }
  const evidenceTimes = new Map<string, EvidenceTime>();
  for (const item of evidence) {
    evidenceTimes.set(String(item.id), resolveEvidenceTime({
      evidence: item,
      links: linksByEvidence.get(String(item.id)) ?? [],
      skillRuns: skillRunsByAgent.get(String(item.agent_run_id)) ?? [],
      portfolioSnapshot,
      riskAssessment,
      profileSnapshot,
    }));
  }
  const compliance = parseJson<Record<string, unknown>>(String(run.compliance_json ?? "{}"), {});
  const missingEvidence = buildMissingEvidence({ evidence, evidenceLinks, toolCalls, skillRuns, marketSnapshots, recommendations, conflicts, compliance });
  const runStatus = String(run.status ?? "unknown").toUpperCase();
  const canRetry = runStatus === "FAILED" || runStatus === "INTERRUPTED";

  return NextResponse.json({
    data: {
      analysisId: id,
      analysis: {
        analysisId: id,
        type: String(run.type).toUpperCase(),
        status: runStatus,
        createdAt: run.created_at,
        completedAt: run.completed_at,
      },
      dataFreshness: summarizeFreshness(marketSnapshots, skillRuns),
      evidence: evidence.map((item) => {
        const time = evidenceTimes.get(String(item.id)) ?? {
          dataAsOf: String(item.created_at),
          timeBasis: "EVIDENCE_CREATED" as const,
        };
        return {
          id: item.id,
          category: String(item.kind).toUpperCase(),
          stance: String(item.stance).toUpperCase(),
          title: item.title,
          summary: item.statement ?? item.summary,
          quality: String(item.quality).toUpperCase(),
          dataAsOf: time.dataAsOf,
          timeBasis: time.timeBasis,
          confidenceBps: item.confidence_bps ?? null,
          sources: (linksByEvidence.get(String(item.id)) ?? []).map((source) => formatEvidenceSource(source, time)),
        };
      }),
      agentTrace: agentRuns.map((item) => ({
        id: item.id,
        parentRunId: item.parent_run_id ?? null,
        agent: String(item.agent_type ?? item.type).toUpperCase(),
        status: String(item.status).toUpperCase(),
        inputSummary: publicAgentPurpose(item),
        purpose: publicAgentPurpose(item),
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
      skillRuns: skillRuns.map((item) => {
        const time = verifiedDataTime(item);
        return {
          id: item.id,
          agentRunId: item.agent_run_id,
          toolCallId: item.tool_call_id,
          skill: { slug: item.skill_slug, version: item.skill_version, validationLevel: item.validation_level, license: item.license },
          method: item.method_name,
          status: String(item.status).toUpperCase(),
          quality: String(item.quality_status).toUpperCase(),
          dataAsOf: time.dataAsOf,
          timeBasis: time.timeBasis,
          freshUntil: item.fresh_until,
          outputSummary: item.output_summary,
          error: item.error_code ? { code: item.error_code, message: item.error_message } : null,
        };
      }),
      pandadataProbes: pandadataProbes.map((item) => {
        const time = verifiedDataTime(item);
        return {
          id: item.id,
          agentRunId: item.agent_run_id,
          toolCallId: item.tool_call_id,
          skillRunId: item.skill_run_id,
          method: item.method_name,
          phase: String(item.phase).toUpperCase(),
          status: String(item.status).toUpperCase(),
          durationMs: item.duration_ms,
          dataAsOf: time.dataAsOf,
          timeBasis: time.timeBasis,
          freshness: item.freshness_status ? String(item.freshness_status).toUpperCase() : null,
          error: item.error_category ? { category: item.error_category, message: item.error_message } : null,
        };
      }),
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
      compliance,
      simulationPreview,
      result: parseJson(String(run.result_json ?? "{}"), {}),
      events: getSseEvents(id).map((event) => ({ id: event.id, type: event.type, payload: event.payload, createdAt: event.createdAt })),
      missingEvidence,
      retry: {
        allowed: canRetry,
        reason: canRetry ? null : "该运行已完成或被阻断，请基于当前信息发起新的顾问分析。",
      },
      disclaimer: "证据包用于解释模拟建议，不代表未来收益，不包含隐藏思维链或敏感凭证。",
    },
    meta: meta(),
  });
}
