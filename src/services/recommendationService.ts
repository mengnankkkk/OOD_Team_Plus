import { apiGet, apiPost } from "@/features/frontend-migration/api";
import { sendAdvisorMessageStream } from "@/services/advisorService";
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
    effectiveUntil: displayDate(row.expiresAt ?? row.updatedAt ?? new Date().toISOString()),
    expireCondition: String(row.invalidation ?? "数据或投资逻辑变化时失效"),
    riskImpact: { risks: row.risks ?? [] },
    complianceStatus: String(compliance.status ?? "PENDING").toUpperCase() === "PASSED" ? "approved" : String(compliance.status ?? "").toUpperCase() === "BLOCKED" ? "blocked" : "pending",
    complianceNotes: Array.isArray(compliance.reasons) ? compliance.reasons.join("；") : null,
    status: (["active", "degraded", "blocked", "simulated", "revoked", "expired", "rejected"].includes(status) ? status : "active") as Recommendation["status"],
    createdAt: String(row.createdAt ?? new Date(0).toISOString()),
  };
};

function displayDate(value: unknown): string {
  const text = String(value ?? "");
  const match = text.match(/^\d{4}-\d{2}-\d{2}/u);
  return match?.[0] ?? text;
}

export async function listRecommendations(_userId: string, opts?: { statuses?: string[]; limit?: number }): Promise<Recommendation[]> {
  const result = await apiGet<{ items: ApiRecommendation[] }>(`/api/v1/recommendations?limit=${opts?.limit ?? 20}`);
  const mapped = result.items.map(mapRecommendation);
  return opts?.statuses ? mapped.filter((item) => opts.statuses!.includes(item.status)) : mapped;
}

export async function getRecommendation(_userId: string, id: string): Promise<Recommendation | null> {
  try { return mapRecommendation(await apiGet<ApiRecommendation>(`/api/v1/recommendations/${id}`)); }
  catch { return null; }
}

export type RecommendationDecisionAction = "ACCEPT" | "REJECT" | "DEFER" | "REVOKE" | "FOLLOW_UP" | "VIEWED" | "COMMENT";

export async function recordRecommendationDecision(
  _userId: string,
  id: string,
  action: RecommendationDecisionAction,
  details: { reason?: string; note?: string } = {},
): Promise<void> {
  await apiPost(`/api/v1/recommendations/${id}/decisions`, { action, ...details });
}

export async function updateRecommendationStatus(
  userId: string,
  id: string,
  status: string,
  details: { reason?: string; note?: string } = {},
): Promise<void> {
  const action = status === "rejected" ? "REJECT" : status === "simulated" ? "ACCEPT" : status === "active" ? "REVOKE" : "DEFER";
  await recordRecommendationDecision(userId, id, action, details);
}

export async function listAgentRuns(_userId: string, limit = 10): Promise<AgentRun[]> {
  const result = await apiGet<{ items: Array<Record<string, unknown>> }>(`/api/v1/analyses?limit=${limit}`);
  return result.items.map((item) => ({
    id: String(item.id ?? item.analysisId),
    triggerType: String(item.type ?? "analysis").toLowerCase(),
    type: String(item.type ?? "ANALYSIS"),
    agent: item.agent == null ? null : String(item.agent),
    status: mapRunStatus(item.status),
    plannerSummary: item.summary == null ? null : String(item.summary),
    agentStates: {},
    startedAt: String(item.startedAt ?? item.createdAt ?? new Date(0).toISOString()),
    completedAt: item.completedAt == null ? null : String(item.completedAt),
    recommendationId: item.recommendationId == null ? null : String(item.recommendationId),
    recommendationStatus: item.recommendationStatus == null ? null : String(item.recommendationStatus),
    evidenceCount: Number(item.evidenceCount ?? 0),
    missingEvidenceCount: Number(item.missingEvidenceCount ?? 0),
    toolCount: Number(item.toolCount ?? 0),
    skillCount: Number(item.skillCount ?? 0),
    canRetry: Boolean(item.canRetry),
    failure: item.failure && typeof item.failure === "object"
      ? {
          code: (item.failure as Record<string, unknown>).code == null ? null : String((item.failure as Record<string, unknown>).code),
          message: (item.failure as Record<string, unknown>).message == null ? null : String((item.failure as Record<string, unknown>).message),
        }
      : null,
  }));
}

export async function getEvidenceForRecommendation(_userId: string, recId: string): Promise<EvidencePack | null> {
  const rec = await apiGet<ApiRecommendation>(`/api/v1/recommendations/${recId}`);
  const analysisId = rec.analysisId == null ? null : String(rec.analysisId);
  if (!analysisId) return null;
  const pack = await apiGet<Record<string, unknown>>(`/api/v1/analyses/${analysisId}/evidence-pack`);
  return mapEvidencePack(pack, analysisId, recId);
}

export async function getEvidenceForAnalysis(analysisId: string): Promise<EvidencePack | null> {
  const pack = await apiGet<Record<string, unknown>>(`/api/v1/analyses/${analysisId}/evidence-pack`);
  return mapEvidencePack(pack, analysisId);
}

function mapEvidencePack(pack: Record<string, unknown>, fallbackAnalysisId: string, forcedRecommendationId?: string): EvidencePack {
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
    simulationLog: [],
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function mapRunStatus(value: unknown): AgentRun["status"] {
  const status = String(value ?? "").toUpperCase();
  if (status === "RUNNING" || status === "QUEUED" || status === "PENDING") return "running";
  if (status === "FAILED" || status === "INTERRUPTED") return "failed";
  if (status === "BLOCKED" || status === "WAITING_FOR_USER") return "blocked";
  if (status === "CANCELLED") return "cancelled";
  return "succeeded";
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

type AgentWorkflowObserver = {
  onProgress?: (message: string) => void;
};

const DAILY_PORTFOLIO_PROMPT = [
  "请生成今日组合建议，并运行完整 Agent 回路。",
  "读取我的最新用户画像、目标、现金与全部真实持仓，诊断组合健康度、集中度、浮盈亏、最大回撤约束和压力情景。",
  "数据与研究 Agent 应核验可用的 PandaData 市场证据；组合、风险、建议与合规 Agent 必须分别给出结论。",
  "最终形成一条组合级可执行建议，包含建议动作、执行节奏、支持证据、反方证据、主要风险、替代方案和失效条件。",
  "只用于研究和模拟，不创建真实订单。",
].join("\n");

export async function runAgentWorkflow(_trigger = "manual", observer: AgentWorkflowObserver = {}) {
  void _trigger;
  const result = await sendAdvisorMessageStream(
    DAILY_PORTFOLIO_PROMPT,
    null,
    "SQL_ONLY",
    { onProgress: observer.onProgress },
    "DAILY_PORTFOLIO",
  );
  const recommendation = result.recommendationId
    ? await getRecommendation("", result.recommendationId)
    : null;
  return {
    runId: result.analysisId ?? "",
    recommendations: recommendation ? [recommendation] : [],
    signals: [],
    trace: result.trace ? [result.trace] : [],
    agentStates: {},
    sessionId: result.sessionId,
    clarificationId: result.clarificationId,
    reply: result.reply,
  };
}
