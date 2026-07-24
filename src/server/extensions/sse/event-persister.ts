export const SSE_EVENT_TYPES = [
  "query.planned",
  "query.validated",
  "query.completed",
  "artifact.completed",
  "branch.options.created",
  "branch.created",
  "search.source.completed",
  "portfolio.refreshed",
  "rss.synced",
] as const;

export type SseEventType = (typeof SSE_EVENT_TYPES)[number];

export interface SseEvent {
  id: string;
  type: SseEventType;
  analysisId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export async function persistSseEvent(event: Omit<SseEvent, "id" | "createdAt">): Promise<void> {
  void event;
  // TODO: write to agent_run_events table.
}
