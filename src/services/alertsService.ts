import { apiGet, apiPatch } from "@/features/frontend-migration/api";
import type { Alert, AlertStatus, DecisionLog } from "@/types/app/notice";

type NotificationRow = Record<string, unknown> & { id: string; version?: number };

const mapAlert = (row: NotificationRow): Alert => ({
  id: row.id,
  recommendationId: row.recommendation_id == null ? null : String(row.recommendation_id),
  goalId: row.goal_id == null ? null : String(row.goal_id),
  severity: mapSeverity(String(row.severity ?? "information")),
  title: String(row.title ?? "提醒"),
  message: row.message == null ? null : String(row.message),
  status: row.dismissed_at ? "dismissed" : row.read_at ? "read" : "unread",
  createdAt: String(row.created_at ?? new Date(0).toISOString()),
});

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

export async function listDecisionLogs(_userId: string, limit = 50): Promise<DecisionLog[]> {
  const result = await apiGet<{ items: Array<Record<string, unknown>> }>(`/api/v1/decisions?limit=${limit}`);
  return result.items.map((row) => ({
    id: String(row.id),
    recommendationId: row.recommendationId == null ? null : String(row.recommendationId),
    action: String(row.action ?? "viewed").toLowerCase() as DecisionLog["action"],
    reason: row.reason == null ? null : String(row.reason),
    agentSnapshot: (row.recommendation as Record<string, unknown>) ?? {},
    createdAt: String(row.createdAt),
  }));
}

export function subscribeAlerts(_userId: string, onChange: () => void) {
  const timer = window.setInterval(onChange, 30_000);
  return () => window.clearInterval(timer);
}
