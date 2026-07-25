import {
  A2APublicError,
  type A2ACapability,
  type ExternalClientView,
} from "./contracts";
import {
  createExternalClientInTransaction,
  rotateExternalClientTokenInTransaction,
  type CreateExternalClientInput,
} from "./client-write-service";
import { createId, getDatabase, isoNow, parseJson } from "@/server/http/context";

type ClientRow = {
  id: string;
  name: string;
  status: "ACTIVE" | "DISABLED";
  capabilities_json: string;
  rate_limit_per_minute: number;
  token_prefix: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  row_version: number;
};

type UpdateExternalClientInput = {
  name?: string;
  status?: "ACTIVE" | "DISABLED";
  capabilities?: A2ACapability[];
  rateLimitPerMinute?: number;
  expectedVersion: number;
};

export function createExternalClient(
  actorUserId: string,
  input: CreateExternalClientInput,
): { client: ExternalClientView; token: string } {
  const db = getDatabase();
  try {
    let result: { client: ExternalClientView; token: string } | undefined;
    const transaction = db.transaction(() => {
      result = createExternalClientInTransaction(db, actorUserId, input);
    });
    transaction();
    return requireTransactionResult(result);
  } finally {
    db.close();
  }
}

export function listExternalClients(): ExternalClientView[] {
  const db = getDatabase();
  try {
    return (db.prepare(`${clientSelectSql()} ORDER BY c.created_at DESC, c.id DESC`).all() as ClientRow[])
      .map(toExternalClientView);
  } finally {
    db.close();
  }
}

export function getExternalClient(clientId: string): ExternalClientView | null {
  const db = getDatabase();
  try {
    const row = db.prepare(`${clientSelectSql()} WHERE c.id=?`).get(clientId) as ClientRow | undefined;
    return row ? toExternalClientView(row) : null;
  } finally {
    db.close();
  }
}

export function updateExternalClient(
  actorUserId: string,
  clientId: string,
  input: UpdateExternalClientInput,
): ExternalClientView {
  const db = getDatabase();
  const now = isoNow();
  try {
    let updated: ExternalClientView | undefined;
    const transaction = db.transaction(() => {
      const current = db.prepare(
        "SELECT row_version FROM a2a_external_clients WHERE id=?",
      ).get(clientId) as { row_version: number } | undefined;
      if (!current) throw new A2APublicError("RESOURCE_NOT_FOUND", 404, "External A2A client not found");
      if (current.row_version !== input.expectedVersion) {
        throw new A2APublicError("VERSION_CONFLICT", 412, "External A2A client was modified");
      }

      const result = db.prepare(`UPDATE a2a_external_clients SET
        name=COALESCE(?,name),
        status=COALESCE(?,status),
        capabilities_json=COALESCE(?,capabilities_json),
        rate_limit_per_minute=COALESCE(?,rate_limit_per_minute),
        updated_at=?,
        row_version=row_version+1
        WHERE id=? AND row_version=?`).run(
        input.name ?? null,
        input.status ?? null,
        input.capabilities ? JSON.stringify(input.capabilities) : null,
        input.rateLimitPerMinute ?? null,
        now,
        clientId,
        input.expectedVersion,
      );
      if (result.changes !== 1) {
        throw new A2APublicError("VERSION_CONFLICT", 412, "External A2A client was modified");
      }
      writeAudit(db, {
        actorUserId,
        action: input.status === "DISABLED" ? "A2A_EXTERNAL_CLIENT_DISABLE" : "A2A_EXTERNAL_CLIENT_UPDATE",
        clientId,
        metadata: {
          name: input.name,
          status: input.status,
          capabilities: input.capabilities,
          rateLimitPerMinute: input.rateLimitPerMinute,
          expectedVersion: input.expectedVersion,
        },
        now,
      });
      updated = requireClientRow(db, clientId);
    });
    transaction();
    return requireTransactionResult(updated);
  } finally {
    db.close();
  }
}

export function rotateExternalClientToken(
  actorUserId: string,
  clientId: string,
): { token: string; tokenPrefix: string } {
  const db = getDatabase();
  try {
    let result: { token: string; tokenPrefix: string } | undefined;
    const transaction = db.transaction(() => {
      result = rotateExternalClientTokenInTransaction(db, actorUserId, clientId);
    });
    transaction();
    return requireTransactionResult(result);
  } finally {
    db.close();
  }
}

function requireTransactionResult<T>(result: T | undefined): T {
  if (result === undefined) throw new Error("A2A transaction completed without a result");
  return result;
}

function clientSelectSql(): string {
  return `SELECT c.*,
    (SELECT t.token_prefix
      FROM a2a_external_client_tokens t
      WHERE t.external_client_id=c.id AND t.revoked_at IS NULL
      ORDER BY t.created_at DESC,t.id DESC LIMIT 1) AS token_prefix
    FROM a2a_external_clients c`;
}

function requireClientRow(
  db: ReturnType<typeof getDatabase>,
  clientId: string,
): ExternalClientView {
  const row = db.prepare(`${clientSelectSql()} WHERE c.id=?`).get(clientId) as ClientRow | undefined;
  if (!row) throw new A2APublicError("RESOURCE_NOT_FOUND", 404, "External A2A client not found");
  return toExternalClientView(row);
}

function toExternalClientView(row: ClientRow): ExternalClientView {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    capabilities: parseJson<A2ACapability[]>(row.capabilities_json, []),
    rateLimitPerMinute: row.rate_limit_per_minute,
    tokenPrefix: row.token_prefix,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.row_version,
  };
}

function writeAudit(
  db: ReturnType<typeof getDatabase>,
  input: {
    actorUserId: string;
    action: string;
    clientId: string;
    metadata: Record<string, unknown>;
    now: string;
  },
): void {
  db.prepare(`INSERT INTO audit_events
    (id,actor_type,actor_id,user_id,action,target_type,target_id,outcome,metadata_json,created_at)
    VALUES (?,'USER',?,?,?,'A2A_EXTERNAL_CLIENT',?,'SUCCEEDED',?,?)`).run(
    createId("audit"),
    input.actorUserId,
    input.actorUserId,
    input.action,
    input.clientId,
    JSON.stringify(input.metadata),
    input.now,
  );
}
