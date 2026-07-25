import { apiGet, apiPatch, apiPost } from "@/features/frontend-migration/api";
import type { Alert, AlertStatus, AlertSyncState, DecisionLog } from "@/types/app/notice";

type NotificationRow = Record<string, unknown> & { id: string; version?: number };

const mapAlert = (row: NotificationRow): Alert => ({
  id: row.id,
  recommendationId: row.recommendation_id == null ? null : String(row.recommendation_id),
  goalId: row.goal_id == null ? null : String(row.goal_id),
  sourceType: String(row.sourceType ?? row.source_type ?? "SYSTEM"),
  sourceId: row.sourceId == null && row.source_id == null ? null : String(row.sourceId ?? row.source_id),
  severity: mapSeverity(String(row.severity ?? "information")),
  title: String(row.title ?? "提醒"),
  message: row.bodyText == null && row.body_text == null && row.message == null ? null : String(row.bodyText ?? row.body_text ?? row.message),
  status: String(row.status ?? (row.dismissed_at ? "dismissed" : row.read_at ? "read" : "unread")) as AlertStatus,
  dataAsOf: row.dataAsOf == null && row.data_as_of == null ? null : String(row.dataAsOf ?? row.data_as_of),
  occurrenceCount: Number(row.occurrenceCount ?? row.occurrence_count ?? 1),
  version: Number(row.version ?? row.row_version ?? 1),
  metadata: isRecord(row.metadata) ? row.metadata : parseMetadata(row.metadata_json),
  createdAt: String(row.created_at ?? new Date(0).toISOString()),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mapSeverity(value: string): Alert["severity"] {
  const normalized = value.toLowerCase();
  if (normalized === "urgent") return "urgent";
  if (normalized === "important") return "important";
  if (normalized === "attention" || normalized === "watch") return "watch";
  return "info";
}

export async function listAlerts(_userId: string, opts?: { statuses?: string[]; limit?: number }): Promise<Alert[]> {
  const unreadOnly = opts?.statuses?.length === 1 && opts.statuses[0] === "unread";
  const result = await apiGet<{ items: NotificationRow[] }>(`/api/v1/notifications?limit=${opts?.limit ?? 40}&unreadOnly=${unreadOnly}`);
  return result.items.map(mapAlert).filter((alert) => !opts?.statuses || opts.statuses.includes(alert.status));
}

export async function updateAlertStatus(_userId: string, id: string, status: AlertStatus): Promise<void> {
  const current = await apiGet<NotificationRow>(`/api/v1/notifications/${id}`);
  await apiPatch(`/api/v1/notifications/${id}`, { action: status === "read" ? "MARK_READ" : "IGNORE" }, Number(current.version ?? 1));
}

export async function markAllAlertsRead(): Promise<number> {
  const result = await apiPost<{ updatedCount: number }>("/api/v1/notifications/read-all", {});
  return result.updatedCount;
}

export async function syncAlerts(forceMarketRefresh = false) {
  return apiPost<{ status: string; createdCount: number; marketRefreshSucceeded: boolean; dataAsOf: string | null; errorCode: string | null; errorMessage: string | null }>(
    "/api/v1/notifications/sync",
    { forceMarketRefresh },
  );
}

export async function getAlertSyncState(): Promise<AlertSyncState> {
  return apiGet<AlertSyncState>("/api/v1/notifications/sync");
}

export async function listDecisionLogs(_userId: string, limit = 50): Promise<DecisionLog[]> {
  const result = await apiGet<{ items: Array<Record<string, unknown>> }>(`/api/v1/decisions?limit=${limit}`);
  return result.items.map((row) => ({
    id: String(row.id),
    recommendationId: row.recommendationId == null ? null : String(row.recommendationId),
    analysisId: row.analysisId == null ? null : String(row.analysisId),
    action: normalizeDecisionAction(row.action),
    reason: row.reason == null ? null : String(row.reason),
    note: row.note == null ? null : String(row.note),
    agentSnapshot: (row.recommendation as Record<string, unknown>) ?? {},
    createdAt: String(row.createdAt),
  }));
}

function normalizeDecisionAction(value: unknown): DecisionLog["action"] {
  const action = String(value ?? "").toUpperCase();
  if (action === "ACCEPT" || action === "SIMULATED") return "simulated";
  if (action === "REJECT" || action === "REJECTED") return "rejected";
  if (action === "REVOKE" || action === "REVOKED") return "revoked";
  if (action === "DEFER" || action === "LATER") return "later";
  if (action === "FOLLOWUP_QUESTION") return "followup_question";
  if (action === "COMMENTED") return "commented";
  return "viewed";
}

export function subscribeAlerts(_userId: string, onChange: () => void) {
  const timer = window.setInterval(onChange, 30_000);
  return () => window.clearInterval(timer);
}
