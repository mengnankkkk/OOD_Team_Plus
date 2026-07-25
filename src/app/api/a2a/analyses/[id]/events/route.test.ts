import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";
import {
  A2A_SERVICE_USER_ID,
  resetA2ARateLimitsForTests,
} from "@/server/a2a/auth";
import { createExternalClient } from "@/server/a2a/client-service";
import { getDatabase, isoNow } from "@/server/http/context";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-a2a-events-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
  vi.stubEnv("A2A_BEARER_TOKEN", "legacy-secret");
  resetA2ARateLimitsForTests();
  seedLegacyAnalysis();
});

afterEach(() => {
  resetA2ARateLimitsForTests();
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

describe("GET /api/a2a/analyses/[id]/events", () => {
  it("allows the legacy principal to read its shared analysis", async () => {
    const response = await GET(
      bearerRequest("legacy-secret"),
      { params: Promise.resolve({ id: "legacy-analysis" }) },
    );
    const payload = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(payload).toContain(": connected");
  });

  it("hides legacy shared analyses from database principals with tasks_read", async () => {
    const created = createDatabaseClient(["tasks_read"]);

    const response = await GET(
      bearerRequest(created.token),
      { params: Promise.resolve({ id: "legacy-analysis" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({
      error: { code: "RESOURCE_NOT_FOUND" },
    });
  });

  it("rejects database principals without tasks_read", async () => {
    const created = createDatabaseClient(["debate_mode"]);

    const response = await GET(
      bearerRequest(created.token),
      { params: Promise.resolve({ id: "legacy-analysis" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      error: { code: "CAPABILITY_NOT_ALLOWED" },
    });
  });
});

function bearerRequest(token: string): NextRequest {
  return new NextRequest(
    "http://localhost/api/a2a/analyses/legacy-analysis/events",
    { headers: { authorization: `Bearer ${token}` } },
  );
}

function seedLegacyAnalysis(): void {
  const now = isoNow();
  const db = getDatabase();
  db.prepare(`INSERT INTO users
    (id,username,username_normalized,display_name,role,status,force_password_change,created_at,updated_at,row_version)
    VALUES (?,?,?,?, 'USER','ACTIVE',0,?,?,1)`).run(
    A2A_SERVICE_USER_ID,
    A2A_SERVICE_USER_ID,
    A2A_SERVICE_USER_ID,
    "Legacy A2A",
    now,
    now,
  );
  db.prepare(`INSERT INTO agent_runs
    (id,user_id,type,status,created_at,completed_at)
    VALUES ('legacy-analysis',?,'conversation_agent','completed',?,?)`).run(
    A2A_SERVICE_USER_ID,
    now,
    now,
  );
  db.close();
}

function createDatabaseClient(capabilities: Parameters<typeof createExternalClient>[1]["capabilities"]) {
  const actorUserId = "a2a-admin";
  const now = isoNow();
  const db = getDatabase();
  db.prepare(`INSERT OR IGNORE INTO users
    (id,username,username_normalized,display_name,role,status,force_password_change,created_at,updated_at,row_version)
    VALUES (?,?,?,?, 'ADMIN','ACTIVE',0,?,?,1)`).run(
    actorUserId,
    actorUserId,
    actorUserId,
    "A2A Admin",
    now,
    now,
  );
  db.close();
  return createExternalClient(actorUserId, {
    name: "Database client",
    capabilities,
    rateLimitPerMinute: 60,
  });
}
