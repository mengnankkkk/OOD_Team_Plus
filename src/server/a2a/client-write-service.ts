import { createHash, randomBytes } from "node:crypto";

import {
  A2APublicError,
  type A2ACapability,
  type ExternalClientView,
} from "./contracts";
import { createId, getDatabase, isoNow, parseJson } from "@/server/http/context";

export type CreateExternalClientInput = {
  name: string;
  capabilities: A2ACapability[];
  rateLimitPerMinute: number;
};

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

export function createExternalClientInTransaction(
  db: ReturnType<typeof getDatabase>,
  actorUserId: string,
  input: CreateExternalClientInput,
): { client: ExternalClientView; token: string } {
  const clientId = createId("a2a_client");
  const now = isoNow();
  const generated = generateToken();
  db.prepare(`INSERT INTO a2a_external_clients
    (id,name,status,capabilities_json,rate_limit_per_minute,created_by_user_id,created_at,updated_at,row_version)
    VALUES (?,?,'ACTIVE',?,?,?,?,?,1)`).run(
    clientId,
    input.name,
    JSON.stringify(input.capabilities),
    input.rateLimitPerMinute,
    actorUserId,
    now,
    now,
  );
  db.prepare(`INSERT INTO a2a_external_client_tokens
    (id,external_client_id,token_prefix,token_hash,created_at)
    VALUES (?,?,?,?,?)`).run(
    createId("a2a_token"),
    clientId,
    generated.tokenPrefix,
    generated.tokenHash,
    now,
  );
  writeAudit(db, {
    actorUserId,
    action: "A2A_EXTERNAL_CLIENT_CREATE",
    clientId,
    metadata: {
      name: input.name,
      capabilities: input.capabilities,
      rateLimitPerMinute: input.rateLimitPerMinute,
      tokenPrefix: generated.tokenPrefix,
    },
    now,
  });
  return { client: requireClientRow(db, clientId), token: generated.token };
}

export function rotateExternalClientTokenInTransaction(
  db: ReturnType<typeof getDatabase>,
  actorUserId: string,
  clientId: string,
): { token: string; tokenPrefix: string } {
  const client = db.prepare("SELECT id FROM a2a_external_clients WHERE id=?").get(clientId);
  if (!client) throw new A2APublicError("RESOURCE_NOT_FOUND", 404, "External A2A client not found");

  const now = isoNow();
  const generated = generateToken();
  db.prepare(`UPDATE a2a_external_client_tokens
    SET revoked_at=?
    WHERE external_client_id=? AND revoked_at IS NULL`).run(now, clientId);
  db.prepare(`INSERT INTO a2a_external_client_tokens
    (id,external_client_id,token_prefix,token_hash,created_at)
    VALUES (?,?,?,?,?)`).run(
    createId("a2a_token"),
    clientId,
    generated.tokenPrefix,
    generated.tokenHash,
    now,
  );
  writeAudit(db, {
    actorUserId,
    action: "A2A_EXTERNAL_CLIENT_TOKEN_ROTATE",
    clientId,
    metadata: { tokenPrefix: generated.tokenPrefix },
    now,
  });
  return { token: generated.token, tokenPrefix: generated.tokenPrefix };
}

function generateToken(): { token: string; tokenPrefix: string; tokenHash: string } {
  const secret = randomBytes(32).toString("base64url");
  const tokenPrefix = randomBytes(4).toString("hex");
  const token = `mwa2a_${tokenPrefix}_${secret}`;
  return {
    token,
    tokenPrefix,
    tokenHash: createHash("sha256").update(token).digest("hex"),
  };
}

function requireClientRow(
  db: ReturnType<typeof getDatabase>,
  clientId: string,
): ExternalClientView {
  const row = db.prepare(`SELECT c.*,
    (SELECT t.token_prefix FROM a2a_external_client_tokens t
      WHERE t.external_client_id=c.id AND t.revoked_at IS NULL
      ORDER BY t.created_at DESC,t.id DESC LIMIT 1) AS token_prefix
    FROM a2a_external_clients c WHERE c.id=?`).get(clientId) as ClientRow | undefined;
  if (!row) throw new A2APublicError("RESOURCE_NOT_FOUND", 404, "External A2A client not found");
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
