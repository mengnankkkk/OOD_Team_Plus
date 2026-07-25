import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prepareDatabase } from "@/server/db/migration-runner";
import { ensureBootstrapA2AClient } from "./bootstrap-client";

describe("production A2A bootstrap client", () => {
  beforeEach(() => {
    vi.stubEnv("DB_PATH", `/tmp/a2a-bootstrap-${crypto.randomUUID()}.db`);
    vi.stubEnv("A2A_BOOTSTRAP_CLIENT_TOKEN", "mwa2a_bootstrap_secret-value");
    const db = new Database(process.env.DB_PATH!);
    prepareDatabase(db as never, process.env.DB_PATH!);
    const now = "2026-07-25T00:00:00.000Z";
    db.prepare(`INSERT INTO users
      (id,username,username_normalized,display_name,role,status,force_password_change,created_at,updated_at,row_version)
      VALUES ('admin','admin','admin','Admin','ADMIN','ACTIVE',0,?,?,1)`).run(now, now);
    db.close();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("stores only the token hash and provisions every external capability", () => {
    ensureBootstrapA2AClient();
    const db = new Database(process.env.DB_PATH!);
    const client = db.prepare("SELECT capabilities_json FROM a2a_external_clients WHERE id='a2a-bootstrap-client'")
      .get() as { capabilities_json: string };
    const token = db.prepare("SELECT token_hash FROM a2a_external_client_tokens WHERE external_client_id='a2a-bootstrap-client' AND revoked_at IS NULL")
      .get() as { token_hash: string };
    db.close();

    expect(JSON.parse(client.capabilities_json)).toContain("debate_mode");
    expect(token.token_hash).toBe(createHash("sha256").update("mwa2a_bootstrap_secret-value").digest("hex"));
    expect(token.token_hash).not.toContain("secret-value");
  });
});
