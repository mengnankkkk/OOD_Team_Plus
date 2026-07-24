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
  "agent.started",
  "agent.completed",
  "agent.failed",
  "recommendation.created",
] as const;

export type SseEventType = (typeof SSE_EVENT_TYPES)[number];

export interface SseEvent {
  id: string;
  type: SseEventType;
  analysisId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export function persistSseEvent(event: Omit<SseEvent, "id" | "createdAt">): void {
  const db = getDatabase();
  db.prepare("INSERT INTO agent_run_events (id, agent_run_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)").run(createId("event"), event.analysisId, event.type, json(event.payload), isoNow());
  db.close();
}

export function getSseEvents(analysisId: string, lastEventId?: string | null): SseEvent[] {
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM agent_run_events WHERE agent_run_id = ? ORDER BY created_at, id").all(analysisId) as Array<Record<string, unknown>>;
  db.close();
  const matchedIndex = lastEventId ? rows.findIndex((row) => row.id === lastEventId) : -1;
  const selected = matchedIndex >= 0 ? rows.slice(matchedIndex + 1) : rows;
  return selected.map((row) => ({ id: String(row.id), analysisId: String(row.agent_run_id), type: String(row.event_type) as SseEventType, payload: JSON.parse(String(row.payload_json)), createdAt: String(row.created_at) }));
}
import { createId, getDatabase, isoNow, json } from "@/server/http/context";
