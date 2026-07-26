import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDatabase } from "@/server/http/context";
import { TEST_USER_ID, authenticatedRequest } from "@tests/helpers/auth";

import { POST } from "./route";
import { recoverDataQuery } from "@/server/extensions/query/recovery";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-data-query-resilience-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* Ignore delayed SQLite cleanup. */ }
  }
});

describe("data query resilience", () => {
  it("keeps an empty scoped query artifact empty", async () => {
    const response = await POST(authenticatedRequest(
      "http://localhost/api/v1/data-queries",
      {
        method: "POST",
        body: JSON.stringify({
          questionText: "生成不存在组合的持仓报告",
          requestedDatasets: ["PORTFOLIO_HOLDINGS"],
          outputMode: "FINANCIAL_REPORT",
          requestedLimit: 50,
          accountScope: ["missing-portfolio"],
        }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "empty-scoped-report",
        },
      },
    ));
    const body = await response.json();
    const db = getDatabase();
    const artifact = db.prepare(`SELECT source_snapshot_json FROM generated_artifacts
      WHERE id=?`).get(body.data.artifact.artifactId) as { source_snapshot_json: string };
    const version = db.prepare(`SELECT content_markdown FROM generated_artifact_versions
      WHERE artifact_id=? AND version_no=1`).get(body.data.artifact.artifactId) as {
        content_markdown: string;
      };
    db.close();

    expect(response.status).toBe(202);
    expect(body.data.result.rowCount).toBe(0);
    expect(JSON.parse(artifact.source_snapshot_json)).toMatchObject({ rowCount: 0 });
    expect(version.content_markdown).not.toContain("AAPL");
    expect(version.content_markdown).not.toContain("MSFT");
  });

  it("recovers a completed query when saving the idempotent response fails", async () => {
    const setupDb = getDatabase();
    setupDb.exec(`CREATE TRIGGER fail_data_query_idempotency_save
      BEFORE UPDATE OF response_json ON idempotency_records
      WHEN NEW.operation='data_query'
        AND NEW.idempotency_key='recover-query-response'
        AND NEW.response_json<>''
      BEGIN
        SELECT RAISE(ABORT, 'forced idempotency response failure');
      END`);
    setupDb.close();
    const requestBody = JSON.stringify({
      questionText: "幂等响应失败后恢复持仓报告",
      requestedDatasets: ["PORTFOLIO_HOLDINGS"],
      outputMode: "FINANCIAL_REPORT",
      requestedLimit: 50,
    });
    const createRequest = () => authenticatedRequest(
      "http://localhost/api/v1/data-queries",
      {
        method: "POST",
        body: requestBody,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "recover-query-response",
        },
      },
    );

    const first = await POST(createRequest());
    const firstBody = await first.json();
    const cleanupDb = getDatabase();
    cleanupDb.exec("DROP TRIGGER fail_data_query_idempotency_save");
    cleanupDb.close();
    const replay = await POST(createRequest());
    const replayBody = await replay.json();
    const verifyDb = getDatabase();
    const queryCount = verifyDb.prepare(`SELECT COUNT(*) AS count FROM data_queries
      WHERE question_text='幂等响应失败后恢复持仓报告'`).get() as { count: number };
    const artifactCount = verifyDb.prepare(`SELECT COUNT(*) AS count FROM generated_artifacts
      WHERE source_query_id=?`).get(firstBody.data.resourceId) as { count: number };
    verifyDb.close();

    expect(first.status).toBe(202);
    expect(replay.status).toBe(200);
    expect(replayBody.data.resourceId).toBe(firstBody.data.resourceId);
    expect(replayBody.data.artifact.artifactId).toBe(firstBody.data.artifact.artifactId);
    expect(queryCount.count).toBe(1);
    expect(artifactCount.count).toBe(1);
  });

  it("interrupts a stale running query and releases its idempotency key", () => {
    const db = getDatabase();
    db.prepare(`INSERT INTO agent_runs
      (id,user_id,type,status,created_at)
      VALUES ('stale-query-run',?,'data_query','running','2020-01-01T00:00:00.000Z')`)
      .run(TEST_USER_ID);
    db.prepare(`INSERT INTO data_queries
      (id,user_id,idempotency_key,agent_run_id,question_text,requested_datasets_json,
       output_mode,requested_limit,status,created_at,updated_at,started_at)
      VALUES ('stale-query',?,'stale-query-key','stale-query-run','旧查询','["INSTRUMENTS"]',
        'sql_only',10,'running','2020-01-01T00:00:00.000Z',
        '2020-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z')`)
      .run(TEST_USER_ID);
    db.close();

    expect(recoverDataQuery(TEST_USER_ID, "stale-query-key")).toEqual({ kind: "retry" });

    const verifyDb = getDatabase();
    const query = verifyDb.prepare("SELECT status,idempotency_key FROM data_queries WHERE id='stale-query'")
      .get();
    const run = verifyDb.prepare("SELECT status FROM agent_runs WHERE id='stale-query-run'").get();
    verifyDb.close();
    expect(query).toEqual({ status: "interrupted", idempotency_key: null });
    expect(run).toEqual({ status: "interrupted" });
  });

  it("releases a completed query key when its required artifact is missing", async () => {
    const response = await POST(authenticatedRequest(
      "http://localhost/api/v1/data-queries",
      {
        method: "POST",
        body: JSON.stringify({
          questionText: "生成可恢复报告",
          requestedDatasets: ["PORTFOLIO_HOLDINGS"],
          outputMode: "FINANCIAL_REPORT",
          requestedLimit: 50,
        }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "missing-artifact-retry",
        },
      },
    ));
    const body = await response.json();
    const db = getDatabase();
    db.prepare("DELETE FROM generated_artifacts WHERE id=?")
      .run(body.data.artifact.artifactId);
    db.close();

    expect(recoverDataQuery(TEST_USER_ID, "missing-artifact-retry"))
      .toEqual({ kind: "retry" });

    const verifyDb = getDatabase();
    const query = verifyDb.prepare("SELECT idempotency_key FROM data_queries WHERE id=?")
      .get(body.data.resourceId);
    verifyDb.close();
    expect(query).toEqual({ idempotency_key: null });
  });
});
