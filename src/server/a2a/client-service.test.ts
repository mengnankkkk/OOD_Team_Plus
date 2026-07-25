import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createExternalClient,
  getExternalClient,
  listExternalClients,
  rotateExternalClientToken,
  updateExternalClient,
} from "./client-service";
import {
  A2AAuthError,
  authenticateExternalToken,
  requireA2ACapability,
  resetA2ARateLimitsForTests,
} from "./auth";
import { getDatabase, isoNow } from "@/server/http/context";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-a2a-clients-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
  vi.stubEnv("A2A_BEARER_TOKEN", "");
  resetA2ARateLimitsForTests();
});

afterEach(() => {
  resetA2ARateLimitsForTests();
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

describe("external A2A client service", () => {
  it("returns a raw token once and authenticates by its hash", () => {
    seedAdmin("admin-1");

    const created = createExternalClient("admin-1", {
      name: "Research partner",
      capabilities: ["debate_mode", "tasks_read"],
      rateLimitPerMinute: 30,
    });

    expect(created.token).toMatch(/^mwa2a_[a-f0-9]{8}_[A-Za-z0-9_-]{43}$/u);
    expect(authenticateExternalToken(created.token)).toMatchObject({
      clientId: created.client.id,
      name: "Research partner",
      capabilities: ["debate_mode", "tasks_read"],
      rateLimitPerMinute: 30,
    });

    const db = getDatabase();
    const stored = db.prepare(
      "SELECT token_hash, token_prefix FROM a2a_external_client_tokens WHERE external_client_id=?",
    ).get(created.client.id) as { token_hash: string; token_prefix: string };
    db.close();

    expect(stored.token_hash).not.toBe(created.token);
    expect(stored.token_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(created.client.tokenPrefix).toBe(stored.token_prefix);
    expect(listExternalClients()).toEqual([
      { ...created.client, lastUsedAt: expect.any(String) },
    ]);
    expect(getExternalClient(created.client.id)).toEqual({
      ...created.client,
      lastUsedAt: expect.any(String),
    });
    expect(JSON.stringify(listExternalClients())).not.toContain(created.token);
    expect(JSON.stringify(getExternalClient(created.client.id))).not.toContain(created.token);
  });

  it("revokes the previous token during rotation", () => {
    seedAdmin("admin-1");
    const created = createExternalClient("admin-1", {
      name: "Research partner",
      capabilities: ["research_search"],
      rateLimitPerMinute: 60,
    });

    const rotated = rotateExternalClientToken("admin-1", created.client.id);

    expect(rotated.token).not.toBe(created.token);
    expect(rotated.tokenPrefix).not.toBe(created.client.tokenPrefix);
    expect(authenticateExternalToken(created.token)).toBeNull();
    expect(authenticateExternalToken(rotated.token)?.clientId).toBe(created.client.id);

    const db = getDatabase();
    const tokens = db.prepare(
      "SELECT token_prefix, revoked_at FROM a2a_external_client_tokens WHERE external_client_id=? ORDER BY created_at",
    ).all(created.client.id) as Array<{ token_prefix: string; revoked_at: string | null }>;
    db.close();
    expect(tokens).toHaveLength(2);
    expect(tokens[0]?.revoked_at).not.toBeNull();
    expect(tokens[1]).toEqual({ token_prefix: rotated.tokenPrefix, revoked_at: null });
  });

  it("rejects disabled clients and missing capabilities", () => {
    seedAdmin("admin-1");
    const created = createExternalClient("admin-1", {
      name: "Debate partner",
      capabilities: ["debate_mode"],
      rateLimitPerMinute: 60,
    });
    const principal = authenticateExternalToken(created.token);
    expect(principal).not.toBeNull();

    expect(() => requireA2ACapability(principal!, "research_search")).toThrow(
      expect.objectContaining({ status: 403, code: "A2A_CAPABILITY_FORBIDDEN" }),
    );

    const disabled = updateExternalClient("admin-1", created.client.id, {
      status: "DISABLED",
      expectedVersion: created.client.version,
    });
    expect(disabled).toMatchObject({ status: "DISABLED", version: 2 });
    expect(authenticateExternalToken(created.token)).toBeNull();
  });

  it("enforces and resets the per-client rolling rate limit", () => {
    seedAdmin("admin-1");
    const created = createExternalClient("admin-1", {
      name: "Rate-limited partner",
      capabilities: ["tasks_read"],
      rateLimitPerMinute: 2,
    });

    expect(authenticateExternalToken(created.token)?.clientId).toBe(created.client.id);
    expect(authenticateExternalToken(created.token)?.clientId).toBe(created.client.id);
    expect(() => authenticateExternalToken(created.token)).toThrow(
      expect.objectContaining({ status: 429, code: "A2A_RATE_LIMITED" }),
    );

    resetA2ARateLimitsForTests();
    expect(authenticateExternalToken(created.token)?.clientId).toBe(created.client.id);
  });

  it("never stores raw tokens in audit metadata or SQLite text columns", () => {
    seedAdmin("admin-1");
    const created = createExternalClient("admin-1", {
      name: "Security audit partner",
      capabilities: ["chief_advisor_conversation"],
      rateLimitPerMinute: 60,
    });
    const rotated = rotateExternalClientToken("admin-1", created.client.id);

    const db = getDatabase();
    const metadata = db.prepare(
      "SELECT metadata_json FROM audit_events WHERE target_id=? ORDER BY created_at",
    ).all(created.client.id) as Array<{ metadata_json: string }>;
    const textValues = collectTextValues(db);
    db.close();

    expect(metadata).toHaveLength(2);
    expect(metadata.map((row) => JSON.parse(row.metadata_json))).toEqual([
      expect.objectContaining({ name: "Security audit partner" }),
      expect.objectContaining({ tokenPrefix: rotated.tokenPrefix }),
    ]);
    for (const token of [created.token, rotated.token]) {
      expect(metadata.some((row) => row.metadata_json.includes(token))).toBe(false);
      expect(textValues.some((value) => value.includes(token))).toBe(false);
      expect(fileContains(dbPath, token)).toBe(false);
      expect(fileContains(`${dbPath}-wal`, token)).toBe(false);
    }
  });

  it("uses typed not-found and version-conflict errors", () => {
    seedAdmin("admin-1");
    const created = createExternalClient("admin-1", {
      name: "Versioned partner",
      capabilities: ["tasks_cancel"],
      rateLimitPerMinute: 60,
    });

    expect(() => updateExternalClient("admin-1", created.client.id, {
      name: "Stale update",
      expectedVersion: 99,
    })).toThrow(expect.objectContaining({ status: 412, code: "VERSION_CONFLICT" }));
    expect(() => rotateExternalClientToken("admin-1", "missing-client")).toThrow(
      expect.objectContaining({ status: 404, code: "RESOURCE_NOT_FOUND" }),
    );
    expect(A2AAuthError).toBeTypeOf("function");
  });
});

function seedAdmin(userId: string): void {
  const now = isoNow();
  const db = getDatabase();
  db.prepare(`INSERT INTO users
    (id,username,username_normalized,display_name,role,status,force_password_change,created_at,updated_at,row_version)
    VALUES (?,?,?,?,?,'ACTIVE',0,?,?,1)`).run(
    userId,
    userId,
    userId,
    "A2A Administrator",
    "ADMIN",
    now,
    now,
  );
  db.close();
}

function collectTextValues(db: ReturnType<typeof getDatabase>): string[] {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
  ).all() as Array<{ name: string }>;
  const values: string[] = [];
  for (const { name } of tables) {
    const escapedTable = quoteIdentifier(name);
    const columns = db.prepare(`PRAGMA table_info(${escapedTable})`).all() as Array<{
      name: string;
      type: string;
    }>;
    const textColumns = columns.filter((column) => /TEXT|CHAR|CLOB/iu.test(column.type));
    if (textColumns.length === 0) continue;
    const rows = db.prepare(
      `SELECT ${textColumns.map((column) => quoteIdentifier(column.name)).join(",")} FROM ${escapedTable}`,
    ).all() as Array<Record<string, unknown>>;
    for (const row of rows) {
      for (const value of Object.values(row)) {
        if (typeof value === "string") values.push(value);
      }
    }
  }
  return values;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function fileContains(path: string, value: string): boolean {
  return existsSync(path) && readFileSync(path).includes(Buffer.from(value));
}
