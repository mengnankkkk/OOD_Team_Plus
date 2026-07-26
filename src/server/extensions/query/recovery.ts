import { getDatabase, isoNow } from "@/server/http/context";

import type { ArtifactType } from "../artifacts/service";
import { outputArtifactConfig, type CreateDataQueryInput } from "./service";

const DATA_QUERY_STALE_AFTER_MS = 10 * 60 * 1_000;

export type RecoveredDataQuery = {
  queryId: string;
  analysisId: string;
  status: "COMPLETED";
  result: { rowCount: number; isTruncated: boolean };
  artifact: {
    artifactId: string;
    type: ArtifactType;
    title: string;
    previewUrl: string;
  } | null;
};

export function recoverDataQuery(
  userId: string,
  idempotencyKey: string,
): { kind: "replay"; result: RecoveredDataQuery } | { kind: "retry" } | { kind: "pending" } | null {
  const db = getDatabase();
  try {
    const query = db.prepare(`SELECT id,agent_run_id,status,row_count,is_truncated,
        output_mode,updated_at,started_at
      FROM data_queries WHERE user_id=? AND idempotency_key=?`)
      .get(userId, idempotencyKey) as Record<string, unknown> | undefined;
    if (!query) return null;
    const status = String(query.status);
    if (status === "failed" || status === "cancelled" || status === "interrupted") {
      releaseIdempotencyKey(db, query.id, userId, idempotencyKey);
      return { kind: "retry" };
    }
    if (status === "queued" || status === "running") {
      if (!isStale(query.updated_at ?? query.started_at)) return { kind: "pending" };
      return interruptStaleQuery(db, query, userId, idempotencyKey)
        ? { kind: "retry" }
        : { kind: "pending" };
    }
    if (status !== "succeeded") return { kind: "pending" };

    const outputMode = String(query.output_mode).toUpperCase() as CreateDataQueryInput["outputMode"];
    const artifactConfig = outputArtifactConfig(outputMode);
    const artifactRow = artifactConfig
      ? db.prepare(`SELECT id,artifact_type,status,title FROM generated_artifacts
          WHERE user_id=? AND source_query_id=? AND status!='deleted'
          ORDER BY created_at DESC,id DESC LIMIT 1`)
        .get(userId, query.id) as Record<string, unknown> | undefined
      : undefined;
    if (artifactConfig && (!artifactRow || artifactRow.status !== "ready")) {
      releaseIdempotencyKey(db, query.id, userId, idempotencyKey);
      return { kind: "retry" };
    }
    return {
      kind: "replay",
      result: recoveredResult(query, artifactRow),
    };
  } finally {
    db.close();
  }
}

function interruptStaleQuery(
  db: ReturnType<typeof getDatabase>,
  query: Record<string, unknown>,
  userId: string,
  idempotencyKey: string,
): boolean {
  const now = isoNow();
  let interrupted = false;
  db.transaction(() => {
    const updated = db.prepare(`UPDATE data_queries SET status='interrupted',
      failure_code='QUERY_INTERRUPTED',
      failure_message='查询执行租约已过期，可安全重试。',
      completed_at=?,updated_at=?,idempotency_key=NULL
      WHERE id=? AND user_id=? AND idempotency_key=? AND status IN ('queued','running')`)
      .run(now, now, query.id, userId, idempotencyKey);
    if (!updated.changes) return;
    db.prepare(`UPDATE agent_runs SET status='interrupted',completed_at=?,
      failure_code='QUERY_INTERRUPTED',
      failure_message='查询执行租约已过期，可安全重试。'
      WHERE id=? AND user_id=? AND status IN ('queued','running')`)
      .run(now, query.agent_run_id, userId);
    interrupted = true;
  })();
  return interrupted;
}

function releaseIdempotencyKey(
  db: ReturnType<typeof getDatabase>,
  queryId: unknown,
  userId: string,
  idempotencyKey: string,
): void {
  db.prepare(`UPDATE data_queries SET idempotency_key=NULL
    WHERE id=? AND user_id=? AND idempotency_key=?`)
    .run(queryId, userId, idempotencyKey);
}

function recoveredResult(
  query: Record<string, unknown>,
  artifactRow: Record<string, unknown> | undefined,
): RecoveredDataQuery {
  const artifact = artifactRow ? {
    artifactId: String(artifactRow.id),
    type: String(artifactRow.artifact_type).toUpperCase() as ArtifactType,
    title: String(artifactRow.title),
    previewUrl: `/api/v1/generated-artifacts/${artifactRow.id}/preview`,
  } : null;
  return {
    queryId: String(query.id),
    analysisId: String(query.agent_run_id),
    status: "COMPLETED",
    result: {
      rowCount: Number(query.row_count ?? 0),
      isTruncated: Boolean(query.is_truncated),
    },
    artifact,
  };
}

function isStale(value: unknown): boolean {
  const timestamp = Date.parse(String(value ?? ""));
  return !Number.isFinite(timestamp) || Date.now() - timestamp >= DATA_QUERY_STALE_AFTER_MS;
}
