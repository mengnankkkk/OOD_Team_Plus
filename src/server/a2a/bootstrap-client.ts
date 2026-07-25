import { createHash } from "node:crypto";

import { A2A_CAPABILITIES } from "./contracts";
import { createId, getDatabase, isoNow } from "@/server/http/context";

const BOOTSTRAP_CLIENT_ID = "a2a-bootstrap-client";

export function ensureBootstrapA2AClient(): void {
  const rawToken = process.env.A2A_BOOTSTRAP_CLIENT_TOKEN?.trim();
  if (!rawToken) return;
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const tokenPrefix = tokenPrefixFor(rawToken, tokenHash);
  const db = getDatabase();
  try {
    const admin = db.prepare(`SELECT id FROM users
      WHERE role='ADMIN' AND status='ACTIVE' AND deleted_at IS NULL
      ORDER BY created_at,id LIMIT 1`).get() as { id?: string } | undefined;
    if (!admin?.id) throw new Error("Active administrator is required before A2A bootstrap");
    const now = isoNow();
    const transaction = db.transaction(() => {
      db.prepare(`INSERT INTO a2a_external_clients
        (id,name,status,capabilities_json,rate_limit_per_minute,created_by_user_id,created_at,updated_at,row_version)
        VALUES (?,'Production A2A Client','ACTIVE',?,120,?,?,?,1)
        ON CONFLICT(id) DO UPDATE SET
          status='ACTIVE',
          capabilities_json=excluded.capabilities_json,
          rate_limit_per_minute=excluded.rate_limit_per_minute,
          updated_at=excluded.updated_at,
          row_version=a2a_external_clients.row_version+1`).run(
        BOOTSTRAP_CLIENT_ID,
        JSON.stringify(A2A_CAPABILITIES),
        admin.id,
        now,
        now,
      );
      const active = db.prepare(`SELECT id,token_hash FROM a2a_external_client_tokens
        WHERE external_client_id=? AND revoked_at IS NULL
        ORDER BY created_at DESC,id DESC LIMIT 1`).get(
        BOOTSTRAP_CLIENT_ID,
      ) as { id?: string; token_hash?: string } | undefined;
      if (active?.token_hash === tokenHash) return;
      db.prepare(`UPDATE a2a_external_client_tokens SET revoked_at=?
        WHERE external_client_id=? AND revoked_at IS NULL`).run(now, BOOTSTRAP_CLIENT_ID);
      db.prepare(`INSERT INTO a2a_external_client_tokens
        (id,external_client_id,token_prefix,token_hash,created_at)
        VALUES (?,?,?,?,?)`).run(
        createId("a2a_token"),
        BOOTSTRAP_CLIENT_ID,
        tokenPrefix,
        tokenHash,
        now,
      );
    });
    transaction();
  } finally {
    db.close();
  }
}

function tokenPrefixFor(rawToken: string, tokenHash: string): string {
  return rawToken.match(/^mwa2a_([^_]+)_/u)?.[1]?.slice(0, 32) ?? tokenHash.slice(0, 8);
}
