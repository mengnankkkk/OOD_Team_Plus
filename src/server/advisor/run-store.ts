import type { AdvisorDatabase } from "@/server/advisor/database";
import {
  json,
  newId,
  nowIso,
  parseJson,
  runRows,
  runValue,
  runWrite,
} from "@/server/advisor/store-common";
import type {
  AdvisorEvent,
  AdvisorEventType,
  AdvisorRun,
  AdvisorRunStatus,
  EvidenceItem,
} from "@/server/advisor/types";

type RunRow = {
  id: string;
  session_id: string;
  parent_run_id: string | null;
  root_run_id: string;
  role: AdvisorRun["role"];
  objective: string;
  status: AdvisorRunStatus;
  stage: string | null;
  output_summary: string | null;
  created_at: string;
  completed_at: string | null;
};

export class RunStore {
  constructor(private readonly database: AdvisorDatabase) {}

  createRun(
    input: Omit<AdvisorRun, "id" | "status" | "summary" | "createdAt" | "completedAt" | "rootRunId"> & {
      rootRunId?: string;
      triggerMessageId?: string;
    },
  ) {
    const id = newId("analysis");
    const rootRunId = input.rootRunId ?? id;
    const createdAt = nowIso();
    runWrite(
      this.database,
      `INSERT INTO agent_runs
       (id, session_id, trigger_message_id, parent_run_id, root_run_id, role, objective, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
      id,
      input.conversationId,
      input.triggerMessageId ?? null,
      input.parentRunId,
      rootRunId,
      input.role,
      input.objective,
      createdAt,
    );
    return this.getRun(id)!;
  }

  getRun(runId: string) {
    const row = runValue<RunRow>(this.database, "SELECT * FROM agent_runs WHERE id = ?", runId);
    return row ? mapRun(row) : null;
  }

  listRuns(rootRunId: string) {
    return runRows<RunRow>(
      this.database,
      "SELECT * FROM agent_runs WHERE root_run_id = ? ORDER BY created_at",
      rootRunId,
    ).map(mapRun);
  }

  updateRun(
    runId: string,
    patch: { status: AdvisorRunStatus; summary?: string; stage?: string; errorCode?: string; errorMessage?: string },
  ) {
    const terminal = !["queued", "running", "waiting_user"].includes(patch.status);
    runWrite(
      this.database,
      `UPDATE agent_runs SET status = ?, stage = COALESCE(?, stage),
       output_summary = COALESCE(?, output_summary), error_code = ?, error_message = ?,
       started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN ? ELSE started_at END,
       completed_at = CASE WHEN ? THEN ? ELSE NULL END WHERE id = ?`,
      patch.status,
      patch.stage ?? null,
      patch.summary ?? null,
      patch.errorCode ?? null,
      patch.errorMessage ?? null,
      patch.status,
      nowIso(),
      terminal ? 1 : 0,
      terminal ? nowIso() : null,
      runId,
    );
    return this.getRun(runId);
  }

  appendEvent(input: {
    analysisId: string;
    conversationId: string;
    type: AdvisorEventType;
    payload: Record<string, unknown>;
  }) {
    const sequenceRow = runValue<{ next_sequence: number }>(
      this.database,
      "SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next_sequence FROM agent_run_events WHERE root_run_id = ?",
      input.analysisId,
    );
    const event: AdvisorEvent = {
      ...input,
      id: newId("evt"),
      sequence: sequenceRow?.next_sequence ?? 1,
      occurredAt: nowIso(),
    };
    runWrite(
      this.database,
      `INSERT INTO agent_run_events
       (id, root_run_id, session_id, sequence_no, event_type, payload_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      event.id,
      event.analysisId,
      event.conversationId,
      event.sequence,
      event.type,
      json(event.payload),
      event.occurredAt,
    );
    return event;
  }

  listEvents(analysisId: string, afterEventId?: string | null) {
    const after = afterEventId
      ? runValue<{ sequence_no: number }>(
          this.database,
          "SELECT sequence_no FROM agent_run_events WHERE root_run_id = ? AND id = ?",
          analysisId,
          afterEventId,
        )?.sequence_no ?? 0
      : 0;
    return runRows<{
      id: string;
      root_run_id: string;
      session_id: string;
      sequence_no: number;
      event_type: AdvisorEventType;
      payload_json: string;
      occurred_at: string;
    }>(
      this.database,
      "SELECT * FROM agent_run_events WHERE root_run_id = ? AND sequence_no > ? ORDER BY sequence_no",
      analysisId,
      after,
    ).map((row) => ({
      id: row.id,
      analysisId: row.root_run_id,
      conversationId: row.session_id,
      sequence: row.sequence_no,
      type: row.event_type,
      occurredAt: row.occurred_at,
      payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
    }));
  }

  addEvidence(input: Omit<EvidenceItem, "id" | "createdAt"> & { quality?: string; title?: string }) {
    const item: EvidenceItem = { ...input, id: newId("evidence"), createdAt: nowIso() };
    runWrite(
      this.database,
      `INSERT INTO evidence_items
       (id, agent_run_id, kind, stance, quality, title, statement, is_material, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      item.id,
      input.analysisId,
      input.kind,
      input.stance,
      input.quality ?? "medium",
      input.title ?? input.summary.slice(0, 80),
      input.summary,
      item.createdAt,
    );
    return item;
  }

  listEvidence(analysisId: string) {
    return runRows<{
      id: string;
      agent_run_id: string;
      kind: EvidenceItem["kind"];
      stance: EvidenceItem["stance"];
      statement: string;
      created_at: string;
    }>(this.database, "SELECT * FROM evidence_items WHERE agent_run_id = ? ORDER BY created_at", analysisId).map(
      (row) => ({
        id: row.id,
        analysisId: row.agent_run_id,
        kind: row.kind,
        stance: row.stance,
        summary: row.statement,
        source: row.kind === "market_fact" ? "pandadata" : "derived_engine",
        createdAt: row.created_at,
      }),
    );
  }

  hasAnalysis(analysisId: string) {
    return Boolean(this.getRun(analysisId));
  }

  interruptRunning() {
    runWrite(
      this.database,
      `UPDATE agent_runs SET status = 'interrupted', completed_at = ?
       WHERE status IN ('queued', 'running')`,
      nowIso(),
    );
  }
}

function mapRun(row: RunRow): AdvisorRun {
  return {
    id: row.id,
    conversationId: row.session_id,
    parentRunId: row.parent_run_id,
    rootRunId: row.root_run_id,
    role: row.role,
    objective: row.objective,
    status: row.status,
    stage: row.stage,
    summary: row.output_summary,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}
