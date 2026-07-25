import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createExternalClient } from "@/server/a2a/client-service";
import { getDatabase, isoNow } from "@/server/http/context";

const execFileAsync = promisify(execFile);
const workerPath = join(process.cwd(), "tests/helpers/a2a-idempotency-worker.ts");
const tsxCliPath = join(
  process.cwd(),
  "node_modules/.pnpm/tsx@4.23.1/node_modules/tsx/dist/cli.mjs",
);

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-a2a-concurrency-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
  seedAdmin("admin-1");
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

describe("A2A admin idempotency concurrency", () => {
  it("persists one create across two independent Node processes", async () => {
    const results = await runConcurrentWorkers({
      operation: "create",
      actorUserId: "admin-1",
      idempotencyKey: "create-process-concurrent-1",
      input: {
        name: "Process concurrent partner",
        capabilities: ["scenario_simulation", "tasks_read"],
        rateLimitPerMinute: 25,
      },
    });

    expect(new Set(results.map((result) => result.pid)).size).toBe(2);
    expect(results.map((result) => result.kind).sort()).toEqual(["live", "replay"]);
    expect(new Set(results.map((result) => result.clientId)).size).toBe(1);
    expect(results.filter((result) => result.hasToken)).toHaveLength(1);

    const clientId = results[0]?.clientId;
    const db = getDatabase();
    const persisted = {
      clients: count(db, "SELECT count(*) AS count FROM a2a_external_clients WHERE id=?", clientId),
      tokens: count(db, "SELECT count(*) AS count FROM a2a_external_client_tokens WHERE external_client_id=?", clientId),
      audits: count(db, "SELECT count(*) AS count FROM audit_events WHERE target_id=? AND action='A2A_EXTERNAL_CLIENT_CREATE'", clientId),
      idempotency: db.prepare(`SELECT resource_id,response_json
        FROM idempotency_records
        WHERE user_id=? AND operation='admin_a2a_client_create' AND idempotency_key=?`).get(
        "admin-1",
        "create-process-concurrent-1",
      ) as { resource_id: string; response_json: string },
    };
    db.close();

    expect(persisted.clients).toBe(1);
    expect(persisted.tokens).toBe(1);
    expect(persisted.audits).toBe(1);
    expect(persisted.idempotency.resource_id).toBe(clientId);
    expect(persisted.idempotency.response_json).not.toContain("mwa2a_");
  }, 20_000);

  it("persists one rotation across two independent Node processes", async () => {
    const created = createExternalClient("admin-1", {
      name: "Rotation fixture",
      capabilities: ["tasks_read"],
      rateLimitPerMinute: 60,
    });
    const results = await runConcurrentWorkers({
      operation: "rotate",
      actorUserId: "admin-1",
      clientId: created.client.id,
      idempotencyKey: "rotate-process-concurrent-1",
    });

    expect(new Set(results.map((result) => result.pid)).size).toBe(2);
    expect(results.map((result) => result.kind).sort()).toEqual(["live", "replay"]);
    expect(new Set(results.map((result) => result.tokenPrefix)).size).toBe(1);
    expect(results.filter((result) => result.hasToken)).toHaveLength(1);

    const db = getDatabase();
    const persisted = {
      tokens: count(db, "SELECT count(*) AS count FROM a2a_external_client_tokens WHERE external_client_id=?", created.client.id),
      activeTokens: count(db, "SELECT count(*) AS count FROM a2a_external_client_tokens WHERE external_client_id=? AND revoked_at IS NULL", created.client.id),
      audits: count(db, "SELECT count(*) AS count FROM audit_events WHERE target_id=? AND action='A2A_EXTERNAL_CLIENT_TOKEN_ROTATE'", created.client.id),
      idempotency: db.prepare(`SELECT resource_id,response_json
        FROM idempotency_records
        WHERE user_id=? AND operation=? AND idempotency_key=?`).get(
        "admin-1",
        `admin_a2a_client_rotate:${created.client.id}`,
        "rotate-process-concurrent-1",
      ) as { resource_id: string; response_json: string },
    };
    db.close();

    expect(persisted.tokens).toBe(2);
    expect(persisted.activeTokens).toBe(1);
    expect(persisted.audits).toBe(1);
    expect(persisted.idempotency.resource_id).toBe(created.client.id);
    expect(persisted.idempotency.response_json).not.toContain("mwa2a_");
  }, 20_000);
});

type WorkerInput = {
  operation: "create" | "rotate";
  actorUserId: string;
  idempotencyKey: string;
  clientId?: string;
  input?: {
    name: string;
    capabilities: string[];
    rateLimitPerMinute: number;
  };
};

type WorkerResult = {
  pid: number;
  kind: "live" | "replay";
  clientId?: string;
  tokenPrefix?: string;
  hasToken: boolean;
};

async function runConcurrentWorkers(input: WorkerInput): Promise<WorkerResult[]> {
  const barrierDir = mkdtempSync(join(tmpdir(), "a2a-idempotency-barrier-"));
  const releasePath = join(barrierDir, "release");
  const configs = [0, 1].map((index) => ({
    ...input,
    readyPath: join(barrierDir, `ready-${index}`),
    releasePath,
  }));
  const executions = configs.map((config) => execFileAsync(
    process.execPath,
    [tsxCliPath, workerPath, Buffer.from(JSON.stringify(config)).toString("base64url")],
    {
      cwd: process.cwd(),
      env: { ...process.env, DB_PATH: dbPath },
      timeout: 15_000,
    },
  ));
  try {
    await waitFor(() => configs.every((config) => existsSync(config.readyPath)));
    writeFileSync(releasePath, "go", { flag: "wx" });
    return (await Promise.all(executions)).map(({ stdout }) => {
      const line = stdout.trim().split("\n").at(-1);
      if (!line) throw new Error("A2A idempotency worker returned no result");
      return JSON.parse(line) as WorkerResult;
    });
  } finally {
    rmSync(barrierDir, { recursive: true, force: true });
  }
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for worker barrier");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function count(
  db: ReturnType<typeof getDatabase>,
  sql: string,
  value: unknown,
): number {
  return (db.prepare(sql).get(value) as { count: number }).count;
}

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
