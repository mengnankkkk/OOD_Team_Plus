import type { EvidencePack } from "@/types/app/recommendation";

export function mapEvidencePack(
  pack: Record<string, unknown>,
  fallbackAnalysisId: string,
  forcedRecommendationId?: string,
): EvidencePack {
  const analysis = asRecord(pack.analysis);
  const recommendations = asRecords(pack.recommendations);
  const agentTrace = asRecords(pack.agentTrace);
  const toolCalls = asRecords(pack.toolCalls);
  const skillRuns = asRecords(pack.skillRuns);
  const pandadataProbes = asRecords(pack.pandadataProbes);
  const marketSnapshots = asRecords(pack.marketSnapshots);
  const evidence = asRecords(pack.evidence);
  const conflicts = asRecords(pack.conflicts);
  const compliance = asRecord(pack.compliance);
  const retry = asRecord(pack.retry);
  const simulationPreview = asRecord(pack.simulationPreview);
  const analysisId = String(pack.analysisId ?? analysis.analysisId ?? fallbackAnalysisId);
  const status = String(analysis.status ?? pack.status ?? "UNKNOWN").toUpperCase();
  const workflowNodes = agentTrace.map((item) => ({
    id: String(item.id),
    label: String(item.agent ?? "AGENT"),
    status: workflowStatus(item.status),
    durationMs: durationMs(item.startedAt, item.completedAt),
    summary: String(item.summary ?? item.purpose ?? ""),
  }));
  const workflowEdges = agentTrace.flatMap((item) => item.parentRunId
    ? [{ from: String(item.parentRunId), to: String(item.id) }]
    : []);
  return {
    id: `evidence-${analysisId}`,
    analysisId,
    analysisType: String(analysis.type ?? pack.type ?? "ANALYSIS"),
    status,
    recommendationId: forcedRecommendationId
      ?? (recommendations[0]?.id == null ? null : String(recommendations[0].id)),
    agentRunId: analysisId,
    dataFreshness: asRecord(pack.dataFreshness),
    evidence,
    agentTrace,
    toolCalls,
    skillRuns,
    pandadataProbes,
    marketSnapshots,
    conflicts,
    recommendations,
    compliance,
    missingEvidence: Array.isArray(pack.missingEvidence) ? pack.missingEvidence.map(String) : [],
    retry: {
      allowed: Boolean(retry.allowed),
      reason: retry.reason == null ? null : String(retry.reason),
    },
    disclaimer: String(pack.disclaimer ?? ""),
    dataSnapshots: marketSnapshots,
    workflowDag: { nodes: workflowNodes, edges: workflowEdges },
    researchMetrics: asRecord(pack.result),
    simulationLog: simulationRows(pack.simulationLog, simulationPreview),
    debate: debateFromRecommendation(recommendations[0], evidence),
    riskVerdicts: Object.keys(compliance).length
      ? [{
          rule: "风险与合规发布门",
          verdict: String(compliance.status ?? status).toLowerCase() === "blocked" ? "blocked" : "approved",
          note: Array.isArray(compliance.reasons) ? compliance.reasons.map(String).join("；") : undefined,
        }]
      : [],
    createdAt: String(analysis.createdAt ?? new Date(0).toISOString()),
  };
}

function simulationRows(rawRows: unknown, preview: Record<string, unknown>): Record<string, unknown>[] {
  const rows = asRecords(rawRows);
  if (rows.length) return rows;
  const before = asRecord(preview.before);
  const after = asRecord(preview.after);
  return Object.keys(before).length && Object.keys(after).length ? [before, after] : [];
}

function debateFromRecommendation(
  recommendation: Record<string, unknown> | undefined,
  evidence: Array<Record<string, unknown>>,
) {
  const conclusion = String(recommendation?.summary ?? "本次 Agent 已完成多空观点整理");
  const bull = [
    ...stringList(recommendation?.reasons),
    ...evidence.filter((item) => String(item.stance ?? "").toUpperCase() === "SUPPORT")
      .map((item) => String(item.summary ?? item.title ?? "")).filter(Boolean),
  ].slice(0, 4);
  const bear = [
    ...stringList(recommendation?.counterEvidence),
    ...stringList(recommendation?.risks),
    ...evidence.filter((item) => String(item.stance ?? "").toUpperCase() === "COUNTER")
      .map((item) => String(item.summary ?? item.title ?? "")).filter(Boolean),
  ].slice(0, 4);
  return {
    conclusion,
    bull: bull.length ? [...new Set(bull)] : ["多 Agent 本轮未给出明确多方观点，建议重新生成完整建议。"],
    bear: bear.length ? [...new Set(bear)] : ["多 Agent 本轮未给出明确空方观点，建议补充行情和持仓约束后复核。"],
    source: "MULTI_AGENT_SYNTHESIS",
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return typeof value === "string" && value.trim() ? [value.trim()] : [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function workflowStatus(value: unknown): string {
  const status = String(value ?? "").toUpperCase();
  if (status === "RUNNING" || status === "QUEUED") return "running";
  if (status === "FAILED" || status === "BLOCKED" || status === "INTERRUPTED") return "blocked";
  if (status === "SKIPPED" || status === "CANCELLED") return "skipped";
  return "done";
}

function durationMs(startedAt: unknown, completedAt: unknown): number {
  const start = Date.parse(String(startedAt ?? ""));
  const end = Date.parse(String(completedAt ?? ""));
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}
