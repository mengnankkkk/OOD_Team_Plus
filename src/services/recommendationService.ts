import { apiGet, apiPost } from "@/features/frontend-migration/api";
import type { AgentRun, EvidencePack, EvidenceRow, Recommendation, RecommendationAction } from "@/types/app/recommendation";

type ApiRecommendation = Record<string, unknown>;

function mapAction(value: unknown): RecommendationAction {
  const action = String(value ?? "WATCH").toUpperCase();
  if (action === "SCALE_IN" || action === "TRIAL_BUY" || action === "ADD") return "increase";
  if (action === "SCALE_OUT" || action === "EXIT" || action === "REDUCE" || action === "STOP_ADDING") return "decrease";
  if (action === "HOLD") return "hold";
  return "observe";
}

const evidenceRows = (items: unknown, source: string): EvidenceRow[] =>
  Array.isArray(items) ? items.map((item, index) => typeof item === "string"
    ? { label: `${source} ${index + 1}`, value: item, source }
    : item as EvidenceRow) : [];

const mapRecommendation = (row: ApiRecommendation): Recommendation => {
  const compliance = (row.compliance as Record<string, unknown> | undefined) ?? {};
  const status = String(row.status ?? "ACTIVE").toLowerCase();
  const reasons = row.reasons ?? row.evidence;
  return {
    id: String(row.id),
    userId: "",
    agentRunId: row.analysisId == null ? null : String(row.analysisId),
    goalId: row.goalId == null ? null : String(row.goalId),
    action: mapAction(row.action),
    headline: String(row.summary ?? "专业投资建议"),
    targetSymbol: row.symbol == null ? null : String(row.symbol),
    targetAssetClass: row.assetType == null ? null : String(row.assetType),
    amount: null,
    weight: Array.isArray(row.positionRange) ? Number(row.positionRange[0] ?? 0) : null,
    pace: row.firstPosition == null ? null : String(row.firstPosition),
    driver: evidenceRows(reasons, "支持证据")[0]?.value ?? String(row.summary ?? ""),
    evidence: evidenceRows(reasons, "支持证据"),
    counterEvidence: evidenceRows(row.counterEvidence, "反方证据"),
    effectiveUntil: String(row.expiresAt ?? row.updatedAt ?? new Date().toISOString()),
    expireCondition: String(row.invalidation ?? "数据或投资逻辑变化时失效"),
    riskImpact: { risks: row.risks ?? [] },
    complianceStatus: String(compliance.status ?? "PENDING").toUpperCase() === "PASSED" ? "approved" : String(compliance.status ?? "").toUpperCase() === "BLOCKED" ? "blocked" : "pending",
    complianceNotes: Array.isArray(compliance.reasons) ? compliance.reasons.join("；") : null,
    status: (["active", "simulated", "revoked", "expired", "rejected"].includes(status) ? status : "active") as Recommendation["status"],
    createdAt: String(row.createdAt ?? new Date(0).toISOString()),
  };
};

export async function listRecommendations(_userId: string, opts?: { statuses?: string[]; limit?: number }): Promise<Recommendation[]> {
  const result = await apiGet<{ items: ApiRecommendation[] }>(`/api/v1/recommendations?limit=${opts?.limit ?? 20}`);
  const mapped = result.items.map(mapRecommendation);
  return opts?.statuses ? mapped.filter((item) => opts.statuses!.includes(item.status)) : mapped;
}

export async function getRecommendation(_userId: string, id: string): Promise<Recommendation | null> {
  try { return mapRecommendation(await apiGet<ApiRecommendation>(`/api/v1/recommendations/${id}`)); }
  catch { return null; }
}

export async function updateRecommendationStatus(_userId: string, id: string, status: string): Promise<void> {
  const action = status === "rejected" ? "REJECT" : status === "simulated" ? "ACCEPT" : "DEFER";
  await apiPost(`/api/v1/recommendations/${id}/decisions`, { action });
}

export async function listAgentRuns(userId: string, limit = 10): Promise<AgentRun[]> {
  const recommendations = await listRecommendations(userId, { limit });
  return recommendations.filter((item) => item.agentRunId).map((item) => ({
    id: item.agentRunId!, triggerType: "advisor", status: "succeeded", plannerSummary: item.headline,
    agentStates: {}, startedAt: item.createdAt, completedAt: item.createdAt,
  }));
}

export async function getEvidenceForRecommendation(_userId: string, recId: string): Promise<EvidencePack | null> {
  const rec = await apiGet<ApiRecommendation>(`/api/v1/recommendations/${recId}`);
  const analysisId = rec.analysisId == null ? null : String(rec.analysisId);
  if (!analysisId) return null;
  const pack = await apiGet<Record<string, unknown>>(`/api/v1/analyses/${analysisId}/evidence-pack`);
  const events = Array.isArray(pack.events) ? pack.events : [];
  return {
    id: `evidence-${recId}`,
    recommendationId: recId,
    agentRunId: analysisId,
    dataSnapshots: Array.isArray(pack.evidence) ? pack.evidence : [],
    skillRuns: [],
    workflowDag: { nodes: (events as Array<Record<string, unknown>>).map((event) => ({ id: String(event.id), label: String(event.type), status: "done", durationMs: 0, summary: "" })), edges: [] },
    researchMetrics: (pack.result as Record<string, unknown>) ?? {},
    simulationLog: [],
    riskVerdicts: [],
    createdAt: String((pack.analysis as Record<string, unknown> | undefined)?.createdAt ?? new Date().toISOString()),
  };
}

export async function getEvidenceForAnalysis(analysisId: string): Promise<EvidencePack | null> {
  try {
    const pack = await apiGet<Record<string, unknown>>(`/api/v1/analyses/${analysisId}/evidence-pack`);
    const events = Array.isArray(pack.events) ? pack.events : [];
    const recommendations = Array.isArray(pack.recommendations) ? pack.recommendations as Array<Record<string, unknown>> : [];
    return {
      id: `evidence-${analysisId}`,
      recommendationId: recommendations[0]?.id == null ? null : String(recommendations[0].id),
      agentRunId: analysisId,
      dataSnapshots: Array.isArray(pack.evidence) ? pack.evidence : [],
      skillRuns: [],
      workflowDag: { nodes: (events as Array<Record<string, unknown>>).map((event) => ({ id: String(event.id), label: String(event.type), status: "done", durationMs: 0, summary: "" })), edges: [] },
      researchMetrics: (pack.result as Record<string, unknown>) ?? {}, simulationLog: [], riskVerdicts: [],
      createdAt: String((pack.analysis as Record<string, unknown> | undefined)?.createdAt ?? new Date().toISOString()),
    };
  } catch { return null; }
}

export async function runAgentWorkflow(_trigger = "manual") {
  void _trigger;
  const result = await apiPost<Record<string, unknown>>("/api/v1/analyses", { type: "PORTFOLIO_DIAGNOSTIC", input: { question: "分析当前组合健康度、风险与可执行建议" } });
  return { runId: String(result.analysisId ?? result.id), recommendations: [], signals: [], trace: [], agentStates: {} };
}
