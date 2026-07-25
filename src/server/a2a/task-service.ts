/* eslint-disable max-lines */

import { createHash } from "node:crypto";

import {
  A2APublicError,
  type A2ATaskResult,
  type A2ATaskStatus,
  type A2ATaskView,
  type CapabilityId,
  type PublicA2AError,
} from "./contracts";
import { createId, getDatabase, isoNow, parseJson } from "@/server/http/context";

type TaskRow = {
  id: string;
  external_client_id: string;
  context_id: string;
  capability_id: CapabilityId;
  operation: string;
  request_hash: string;
  status: A2ATaskStatus;
  domain_resource_type: string | null;
  domain_resource_id: string | null;
  result_json: string | null;
  error_json: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type CreateTaskInput = {
  externalClientId: string;
  contextId: string;
  capabilityId: CapabilityId;
  operation: string;
  clientMessageId: string;
  input: Record<string, unknown>;
};

export function createA2ATask(input: CreateTaskInput): { replayed: boolean; task: A2ATaskView } {
  const requestHash = hashRequest(input);
  const db = getDatabase();
  try {
    const now = isoNow();
    const id = createId("a2a_task");
    const expiresAt = new Date(Date.parse(now) + 30 * 86_400_000).toISOString();
    let inserted = false;
    const transaction = db.transaction(() => {
      const result = db.prepare(`INSERT INTO a2a_tasks
        (id,external_client_id,context_id,capability_id,operation,client_message_id,request_hash,status,input_json,created_at,expires_at)
        VALUES (?,?,?,?,?,?,?,'submitted',?,?,?)
        ON CONFLICT(external_client_id,client_message_id) DO NOTHING`).run(
        id,
        input.externalClientId,
        input.contextId,
        input.capabilityId,
        input.operation,
        input.clientMessageId,
        requestHash,
        JSON.stringify(input.input),
        now,
        expiresAt,
      );
      inserted = result.changes === 1;
      if (inserted) {
        appendEventWithDb(db, id, "task.submitted", {
          capabilityId: input.capabilityId,
          operation: input.operation,
        });
      }
    });
    transaction();
    const row = db.prepare(
      "SELECT * FROM a2a_tasks WHERE external_client_id=? AND client_message_id=?",
    ).get(input.externalClientId, input.clientMessageId) as TaskRow | undefined;
    if (!row) throw new Error("A2A task idempotency claim was not persisted");
    if (row.request_hash !== requestHash) {
      throw new A2APublicError("IDEMPOTENCY_CONFLICT", 409, "IDEMPOTENCY_CONFLICT");
    }
    return { replayed: !inserted, task: taskView(db, row) };
  } finally {
    db.close();
  }
}

export function startA2ATask(clientId: string, taskId: string): A2ATaskView {
  return updateTask(clientId, taskId, "working", { startedAt: isoNow() }, "task.working");
}

export function completeA2ATask(clientId: string, taskId: string, result: A2ATaskResult): A2ATaskView {
  return updateTask(clientId, taskId, "completed", { result, completedAt: isoNow() }, "task.completed");
}

export function requireInputForA2ATask(clientId: string, taskId: string, result: A2ATaskResult): A2ATaskView {
  return updateTask(clientId, taskId, "input-required", { result }, "task.input-required");
}

export function failA2ATask(clientId: string, taskId: string, error: PublicA2AError): A2ATaskView {
  return updateTask(clientId, taskId, "failed", { error, completedAt: isoNow() }, "task.failed");
}

export function cancelA2ATask(clientId: string, taskId: string): A2ATaskView {
  const task = getA2ATask(clientId, taskId);
  if (!task) throw new A2APublicError("TASK_NOT_FOUND", 404, "Task not found");
  if (!["submitted", "working", "input-required"].includes(task.status)) {
    throw new A2APublicError("TASK_NOT_CANCELLABLE", 409, "Task is already terminal");
  }
  const now = isoNow();
  const canceled = updateTask(
    clientId,
    taskId,
    "canceled",
    { completedAt: now, cancelledAt: now },
    "task.canceled",
  );
  if (canceled.status !== "canceled") {
    throw new A2APublicError("TASK_NOT_CANCELLABLE", 409, "Task is already terminal");
  }
  return canceled;
}

export function setA2ATaskDomainResource(
  clientId: string,
  taskId: string,
  domainResourceType: string,
  domainResourceId: string,
): A2ATaskView {
  const db = getDatabase();
  try {
    const result = db.prepare(`UPDATE a2a_tasks SET domain_resource_type=?,domain_resource_id=?
      WHERE id=? AND external_client_id=?`).run(domainResourceType, domainResourceId, taskId, clientId);
    if (result.changes !== 1) throw new A2APublicError("TASK_NOT_FOUND", 404, "Task not found");
    return requireTaskWithDb(db, clientId, taskId);
  } finally {
    db.close();
  }
}

export function getA2ATask(clientId: string, taskId: string): A2ATaskView | null {
  const db = getDatabase();
  try {
    const row = db.prepare("SELECT * FROM a2a_tasks WHERE id=? AND external_client_id=?")
      .get(taskId, clientId) as TaskRow | undefined;
    return row ? taskView(db, row) : null;
  } finally {
    db.close();
  }
}

export function listA2ATasks(
  clientId: string,
  input: { limit: number; cursor?: string },
): { items: A2ATaskView[]; nextCursor: string | null } {
  const db = getDatabase();
  try {
    const rows = db.prepare(`SELECT * FROM a2a_tasks
      WHERE external_client_id=? AND (? IS NULL OR id<?)
      ORDER BY created_at DESC,id DESC LIMIT ?`).all(
      clientId,
      input.cursor ?? null,
      input.cursor ?? null,
      Math.min(Math.max(input.limit, 1), 100) + 1,
    ) as TaskRow[];
    const hasMore = rows.length > input.limit;
    const page = rows.slice(0, input.limit);
    return {
      items: page.map((row) => taskView(db, row)),
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    };
  } finally {
    db.close();
  }
}

export function appendA2ATaskEvent(clientId: string, taskId: string, eventType: string, payload: unknown): void {
  const db = getDatabase();
  try {
    requireTaskWithDb(db, clientId, taskId);
    appendEventWithDb(db, taskId, eventType, payload);
  } finally {
    db.close();
  }
}

function updateTask(
  clientId: string,
  taskId: string,
  status: A2ATaskStatus,
  values: {
    result?: A2ATaskResult;
    error?: PublicA2AError;
    startedAt?: string;
    completedAt?: string;
    cancelledAt?: string;
  },
  eventType: string,
): A2ATaskView {
  const db = getDatabase();
  try {
    const result = db.prepare(`UPDATE a2a_tasks SET status=?,result_json=COALESCE(?,result_json),
      error_json=COALESCE(?,error_json),started_at=COALESCE(?,started_at),
      completed_at=COALESCE(?,completed_at),cancelled_at=COALESCE(?,cancelled_at)
      WHERE id=? AND external_client_id=?
        AND status NOT IN ('completed','canceled','failed')`).run(
      status,
      values.result ? JSON.stringify(values.result) : null,
      values.error ? JSON.stringify(values.error) : null,
      values.startedAt ?? null,
      values.completedAt ?? null,
      values.cancelledAt ?? null,
      taskId,
      clientId,
    );
    if (result.changes !== 1) {
      return requireTaskWithDb(db, clientId, taskId);
    }
    appendEventWithDb(db, taskId, eventType, values.result ?? values.error ?? { status });
    return requireTaskWithDb(db, clientId, taskId);
  } finally {
    db.close();
  }
}

function requireTaskWithDb(db: ReturnType<typeof getDatabase>, clientId: string, taskId: string): A2ATaskView {
  const row = db.prepare("SELECT * FROM a2a_tasks WHERE id=? AND external_client_id=?")
    .get(taskId, clientId) as TaskRow | undefined;
  if (!row) throw new A2APublicError("TASK_NOT_FOUND", 404, "Task not found");
  return taskView(db, row);
}

function taskView(db: ReturnType<typeof getDatabase>, row: TaskRow): A2ATaskView {
  const events = db.prepare("SELECT sequence_no,event_type,payload_json,created_at FROM a2a_task_events WHERE task_id=? ORDER BY sequence_no")
    .all(row.id) as Array<{ sequence_no: number; event_type: string; payload_json: string; created_at: string }>;
  return {
    id: row.id,
    externalClientId: row.external_client_id,
    contextId: row.context_id,
    capabilityId: row.capability_id,
    operation: row.operation,
    status: row.status,
    domainResourceType: row.domain_resource_type,
    domainResourceId: row.domain_resource_id,
    result: parseJson<A2ATaskResult | null>(row.result_json, null),
    error: parseJson<PublicA2AError | null>(row.error_json, null),
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    events: events.map((event) => ({
      sequenceNo: event.sequence_no,
      eventType: event.event_type,
      payload: parseJson(event.payload_json, {}),
      createdAt: event.created_at,
    })),
  };
}

function appendEventWithDb(db: ReturnType<typeof getDatabase>, taskId: string, eventType: string, payload: unknown): void {
  const row = db.prepare("SELECT COALESCE(MAX(sequence_no),0)+1 AS next FROM a2a_task_events WHERE task_id=?")
    .get(taskId) as { next: number };
  db.prepare("INSERT INTO a2a_task_events (id,task_id,sequence_no,event_type,payload_json,created_at) VALUES (?,?,?,?,?,?)")
    .run(createId("a2a_event"), taskId, row.next, eventType, JSON.stringify(payload), isoNow());
}

function hashRequest(input: CreateTaskInput): string {
  return createHash("sha256").update(JSON.stringify(sortKeys(input))).digest("hex");
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, sortKeys(nested)]));
}
