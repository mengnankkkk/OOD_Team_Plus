import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticatedRequest } from "@tests/helpers/auth";

import { GET as GET_DETAIL, PATCH } from "./[id]/route";
import { POST as ROTATE } from "./[id]/rotate-token/route";
import { GET, POST } from "./route";
import { authenticateExternalToken, resetA2ARateLimitsForTests } from "@/server/a2a/auth";
import { createExternalClient } from "@/server/a2a/client-service";
import { getDatabase } from "@/server/http/context";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-a2a-admin-${randomUUID()}.db`);
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

describe("/api/v1/admin/a2a-clients", () => {
  it("creates, lists, and reads a scoped client without exposing its raw token", async () => {
    const response = await POST(authenticatedRequest("http://localhost/api/v1/admin/a2a-clients", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "a2a-client-create-1",
      },
      body: JSON.stringify({
        name: "Partner",
        capabilities: ["debate_mode", "tasks_read"],
        rateLimitPerMinute: 20,
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.client).toMatchObject({
      name: "Partner",
      capabilities: ["debate_mode", "tasks_read"],
      rateLimitPerMinute: 20,
      status: "ACTIVE",
      version: 1,
    });
    expect(body.data.token).toMatch(/^mwa2a_/u);

    const listed = await GET(authenticatedRequest("http://localhost/api/v1/admin/a2a-clients"));
    const listBody = await listed.json();
    expect(listed.status).toBe(200);
    expect(listBody.data.items).toHaveLength(1);
    expect(listBody.data.items[0]).not.toHaveProperty("token");

    const detail = await GET_DETAIL(
      authenticatedRequest(`http://localhost/api/v1/admin/a2a-clients/${body.data.client.id}`),
      { params: Promise.resolve({ id: body.data.client.id as string }) },
    );
    const detailBody = await detail.json();
    expect(detail.status).toBe(200);
    expect(detailBody.data.client).toMatchObject({ id: body.data.client.id, name: "Partner" });
    expect(detailBody.data.client).not.toHaveProperty("token");
  });

  it("rejects non-admin users", async () => {
    const response = await GET(authenticatedRequest(
      "http://localhost/api/v1/admin/a2a-clients",
      {},
      { role: "USER" },
    ));

    expect(response.status).toBe(403);
  });

  it("enforces If-Match and disables authentication", async () => {
    const created = createExternalClientFixture();

    const stale = await PATCH(
      authenticatedRequest(`http://localhost/api/v1/admin/a2a-clients/${created.client.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "if-match": "99" },
        body: JSON.stringify({ status: "DISABLED" }),
      }),
      { params: Promise.resolve({ id: created.client.id }) },
    );
    expect(stale.status).toBe(412);

    const disabled = await PATCH(
      authenticatedRequest(`http://localhost/api/v1/admin/a2a-clients/${created.client.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "if-match": "1" },
        body: JSON.stringify({ status: "DISABLED" }),
      }),
      { params: Promise.resolve({ id: created.client.id }) },
    );
    const body = await disabled.json();
    expect(disabled.status).toBe(200);
    expect(body.data.client).toMatchObject({ status: "DISABLED", version: 2 });
    expect(authenticateExternalToken(created.token)).toBeNull();
  });

  it("rotates a token and revokes the old token", async () => {
    const created = createExternalClientFixture();
    const response = await ROTATE(
      authenticatedRequest(
        `http://localhost/api/v1/admin/a2a-clients/${created.client.id}/rotate-token`,
        { method: "POST", headers: { "idempotency-key": "rotate-1" } },
      ),
      { params: Promise.resolve({ id: created.client.id }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.token).toMatch(/^mwa2a_/u);
    expect(body.data.token).not.toBe(created.token);
    expect(authenticateExternalToken(created.token)).toBeNull();
    expect(authenticateExternalToken(body.data.token)?.clientId).toBe(created.client.id);
  });

  it("replays create idempotently without storing or returning the raw token again", async () => {
    const requestBody = {
      name: "Idempotent partner",
      capabilities: ["research_search"],
      rateLimitPerMinute: 15,
    };
    const first = await POST(createRequest("create-replay-1", requestBody));
    const firstBody = await first.json();
    const replay = await POST(createRequest("create-replay-1", requestBody));
    const replayBody = await replay.json();

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replayBody.data.client.id).toBe(firstBody.data.client.id);
    expect(replayBody.data).not.toHaveProperty("token");

    const conflict = await POST(createRequest("create-replay-1", {
      ...requestBody,
      name: "Different partner",
    }));
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");

    const db = getDatabase();
    const row = db.prepare(
      "SELECT response_json FROM idempotency_records WHERE operation='admin_a2a_client_create'",
    ).get() as { response_json: string };
    const count = db.prepare("SELECT count(*) AS count FROM a2a_external_clients").get() as { count: number };
    db.close();
    expect(row.response_json).not.toContain(firstBody.data.token);
    expect(count.count).toBe(1);
  });

  it("replays token rotation without rotating again or returning the raw token twice", async () => {
    const created = createExternalClientFixture();
    const rotate = () => ROTATE(
      authenticatedRequest(
        `http://localhost/api/v1/admin/a2a-clients/${created.client.id}/rotate-token`,
        { method: "POST", headers: { "idempotency-key": "rotate-replay-1" } },
      ),
      { params: Promise.resolve({ id: created.client.id }) },
    );

    const first = await rotate();
    const firstBody = await first.json();
    const replay = await rotate();
    const replayBody = await replay.json();

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replayBody.data).toEqual({ tokenPrefix: firstBody.data.tokenPrefix });

    const db = getDatabase();
    const active = db.prepare(
      "SELECT count(*) AS count FROM a2a_external_client_tokens WHERE external_client_id=? AND revoked_at IS NULL",
    ).get(created.client.id) as { count: number };
    const responseRow = db.prepare(
      "SELECT response_json FROM idempotency_records WHERE operation=?",
    ).get(`admin_a2a_client_rotate:${created.client.id}`) as { response_json: string };
    db.close();
    expect(active.count).toBe(1);
    expect(responseRow.response_json).not.toContain(firstBody.data.token);
  });

  it("creates only one client when identical idempotent requests arrive concurrently", async () => {
    const requestBody = {
      name: "Concurrent partner",
      capabilities: ["scenario_simulation", "tasks_read"],
      rateLimitPerMinute: 25,
    };

    const responses = await Promise.all([
      POST(createRequest("create-concurrent-1", requestBody)),
      POST(createRequest("create-concurrent-1", requestBody)),
    ]);
    const bodies = await Promise.all(responses.map((response) => response.json()));

    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(new Set(bodies.map((body) => body.data.client.id)).size).toBe(1);
    expect(bodies.filter((body) => typeof body.data.token === "string")).toHaveLength(1);
    expect(bodies.filter((body) => body.data.token === undefined)).toHaveLength(1);

    const db = getDatabase();
    const clients = db.prepare(
      "SELECT count(*) AS count FROM a2a_external_clients WHERE name=?",
    ).get(requestBody.name) as { count: number };
    const tokens = db.prepare(
      `SELECT count(*) AS count FROM a2a_external_client_tokens
        WHERE external_client_id=(SELECT id FROM a2a_external_clients WHERE name=?)`,
    ).get(requestBody.name) as { count: number };
    db.close();
    expect(clients.count).toBe(1);
    expect(tokens.count).toBe(1);
  });

  it("rotates only once when identical idempotent requests arrive concurrently", async () => {
    const created = createExternalClientFixture();
    const rotate = () => ROTATE(
      authenticatedRequest(
        `http://localhost/api/v1/admin/a2a-clients/${created.client.id}/rotate-token`,
        { method: "POST", headers: { "idempotency-key": "rotate-concurrent-1" } },
      ),
      { params: Promise.resolve({ id: created.client.id }) },
    );

    const responses = await Promise.all([rotate(), rotate()]);
    const bodies = await Promise.all(responses.map((response) => response.json()));

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(bodies.filter((body) => typeof body.data.token === "string")).toHaveLength(1);
    expect(bodies.filter((body) => body.data.token === undefined)).toHaveLength(1);
    expect(new Set(bodies.map((body) => body.data.tokenPrefix)).size).toBe(1);

    const db = getDatabase();
    const tokenRows = db.prepare(
      "SELECT count(*) AS count FROM a2a_external_client_tokens WHERE external_client_id=?",
    ).get(created.client.id) as { count: number };
    const activeRows = db.prepare(
      "SELECT count(*) AS count FROM a2a_external_client_tokens WHERE external_client_id=? AND revoked_at IS NULL",
    ).get(created.client.id) as { count: number };
    db.close();
    expect(tokenRows.count).toBe(2);
    expect(activeRows.count).toBe(1);
  });
});

function createExternalClientFixture() {
  const request = authenticatedRequest("http://localhost/api/v1/admin/a2a-clients");
  const userId = request.cookies.get("mw_session") ? "test-auth-user" : "missing";
  return createExternalClient(userId, {
    name: "Fixture partner",
    capabilities: ["debate_mode", "tasks_read"],
    rateLimitPerMinute: 60,
  });
}

function createRequest(key: string, body: unknown) {
  return authenticatedRequest("http://localhost/api/v1/admin/a2a-clients", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify(body),
  });
}
