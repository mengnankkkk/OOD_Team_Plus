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
  "agent.delegated",
  "agent.completed",
  "agent.failed",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "evidence.added",
  "compliance.completed",
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
  const now = isoNow();
  const run = db.prepare("SELECT session_id FROM agent_runs WHERE id=?").get(event.analysisId) as { session_id?: string } | undefined;
  const transaction = db.transaction(() => {
    const sequence = db.prepare("SELECT COALESCE(MAX(sequence_no),0)+1 AS next FROM agent_run_events WHERE root_run_id=?").get(event.analysisId) as { next: number };
    db.prepare(`INSERT INTO agent_run_events
      (id,agent_run_id,root_run_id,session_id,sequence_no,event_type,payload_json,occurred_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      createId("event"), event.analysisId, event.analysisId, run?.session_id ?? null, sequence.next, event.type, json(event.payload), now, now,
    );
  });
  transaction();
  db.close();
}

export function getSseEvents(analysisId: string, lastEventId?: string | null): SseEvent[] {
  const db = getDatabase();
  const rows = db.prepare(`SELECT * FROM agent_run_events
    WHERE COALESCE(root_run_id,agent_run_id)=?
    ORDER BY COALESCE(sequence_no,2147483647),created_at,id`).all(analysisId) as Array<Record<string, unknown>>;
  db.close();
  const matchedIndex = lastEventId ? rows.findIndex((row) => row.id === lastEventId) : -1;
  const selected = matchedIndex >= 0 ? rows.slice(matchedIndex + 1) : rows;
  return selected.map((row) => ({ id: String(row.id), analysisId: String(row.agent_run_id), type: String(row.event_type) as SseEventType, payload: JSON.parse(String(row.payload_json)), createdAt: String(row.created_at) }));
}
import { createId, getDatabase, isoNow, json } from "@/server/http/context";
