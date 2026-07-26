import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDatabase } from "@/server/http/context";
import { authenticatedRequest } from "@tests/helpers/auth";
import { GET, POST } from "./route";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-data-query-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* Windows may retain a failed SQLite handle briefly. */ }
  }
});

describe("POST /api/v1/data-queries", () => {
  it("returns 400 when Idempotency-Key is missing", async () => {
    const req = authenticatedRequest("http://localhost/api/v1/data-queries", {
      method: "POST",
      body: JSON.stringify({
        questionText: "show my portfolio",
        requestedDatasets: ["portfolio_snapshots"],
        outputMode: "SQL_ONLY",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid outputMode", async () => {
    const req = authenticatedRequest("http://localhost/api/v1/data-queries", {
      method: "POST",
      body: JSON.stringify({
        questionText: "q",
        requestedDatasets: ["d"],
        outputMode: "INVALID",
      }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "key1" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 202 with analysisId for valid request", async () => {
    const req = authenticatedRequest("http://localhost/api/v1/data-queries", {
      method: "POST",
      body: JSON.stringify({
        questionText: "show my portfolio",
        requestedDatasets: ["portfolio_snapshots"],
        outputMode: "SQL_ONLY",
      }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "key1" },
    });

    const res = await POST(req);
    expect(res.status).toBe(202);

    const data = await res.json();
    expect(data.data.analysis.type).toBe("DATA_QUERY");
    expect(data.data.analysis.status).toBe("COMPLETED");
    expect(data.data.result.rowCount).toBeGreaterThan(0);
    expect(data.data.analysis.streamUrl).toContain("/api/v1/analyses/");
  });

  it("generates a report artifact when the requested output mode is FINANCIAL_REPORT", async () => {
    const setupDb = getDatabase();
    setupDb.prepare(`INSERT INTO portfolio_snapshots
      (id,user_id,portfolio_id,cash_decimal,total_market_value_decimal,data_quality,
       source_statuses_json,as_of,created_at)
      VALUES ('historical-report-snapshot',?,'portfolio-test-auth-user','0','9999',
        'complete','[]','2025-07-25T00:00:00.000Z','2025-07-25T00:00:00.000Z')`)
      .run("test-auth-user");
    setupDb.prepare(`INSERT INTO holding_snapshots
      (id,portfolio_snapshot_id,instrument_id,quantity_decimal,cost_decimal,price_decimal,
       market_value_decimal,unrealized_pnl_decimal,weight_bps,created_at)
      VALUES ('historical-report-aapl','historical-report-snapshot','AAPL','99','1','100',
        '9900','9801',9900,'2025-07-25T00:00:00.000Z')`).run();
    setupDb.close();

    const req = authenticatedRequest("http://localhost/api/v1/data-queries", {
      method: "POST",
      body: JSON.stringify({
        questionText: "列出我的持仓代码、数量、市值和浮盈亏",
        requestedDatasets: ["PORTFOLIO_HOLDINGS"],
        outputMode: "FINANCIAL_REPORT",
        requestedLimit: 50,
      }),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "financial-report-query",
      },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.data.result.rowCount).toBe(2);
    expect(body.data.artifact).toMatchObject({
      type: "MARKDOWN",
      title: "当前持仓财务分析报告",
    });
    const db = getDatabase();
    const artifact = db.prepare(`SELECT id,source_query_id,artifact_type,status,title
      FROM generated_artifacts WHERE id=?`).get(body.data.artifact.artifactId);
    const chunks = db.prepare(`SELECT rows_json FROM data_query_result_chunks
      WHERE query_id=? ORDER BY chunk_no`).all(body.data.resourceId) as Array<{ rows_json: string }>;
    db.close();
    expect(artifact).toMatchObject({
      source_query_id: body.data.resourceId,
      artifact_type: "markdown",
      status: "ready",
      title: "当前持仓财务分析报告",
    });
    const rows = chunks.flatMap((chunk) => JSON.parse(chunk.rows_json) as Array<Record<string, unknown>>);
    expect(rows.some((row) => row.quantity === "99")).toBe(false);
  });

  it("keeps a completed query and artifact when SSE persistence fails", async () => {
    const setupDb = getDatabase();
    setupDb.exec(`CREATE TRIGGER fail_query_sse_events
      BEFORE INSERT ON agent_run_events
      BEGIN
        SELECT RAISE(ABORT, 'forced SSE failure');
      END`);
    setupDb.close();

    const req = authenticatedRequest("http://localhost/api/v1/data-queries", {
      method: "POST",
      body: JSON.stringify({
        questionText: "SSE 失败时仍生成当前持仓报告",
        requestedDatasets: ["PORTFOLIO_HOLDINGS"],
        outputMode: "FINANCIAL_REPORT",
        requestedLimit: 50,
      }),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "sse-failure-financial-report",
      },
    });

    const res = await POST(req);
    const body = await res.json();
    const db = getDatabase();
    const query = body.data?.resourceId
      ? db.prepare("SELECT status FROM data_queries WHERE id=?").get(body.data.resourceId)
      : undefined;
    const artifact = body.data?.artifact?.artifactId
      ? db.prepare("SELECT status FROM generated_artifacts WHERE id=?").get(body.data.artifact.artifactId)
      : undefined;
    db.exec("DROP TRIGGER fail_query_sse_events");
    db.close();

    expect(res.status).toBe(202);
    expect(query).toEqual({ status: "succeeded" });
    expect(artifact).toEqual({ status: "ready" });
  });

  it("runs concurrent report requests with the same idempotency key only once", async () => {
    const body = JSON.stringify({
      questionText: "并发生成当前持仓报告",
      requestedDatasets: ["PORTFOLIO_HOLDINGS"],
      outputMode: "FINANCIAL_REPORT",
      requestedLimit: 50,
    });
    const requests = [0, 1].map(() => authenticatedRequest(
      "http://localhost/api/v1/data-queries",
      {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "concurrent-financial-report-query",
        },
      },
    ));

    const responses = await Promise.all(requests.map((request) => POST(request)));
    const payloads = await Promise.all(responses.map((response) => response.json()));

    expect(responses.map((response) => response.status).sort()).toEqual([200, 202]);
    expect(payloads[0].data.resourceId).toBe(payloads[1].data.resourceId);
    expect(payloads[0].data.artifact.artifactId).toBe(payloads[1].data.artifact.artifactId);
    const db = getDatabase();
    const queryCount = db.prepare(`SELECT COUNT(*) AS count FROM data_queries
      WHERE question_text='并发生成当前持仓报告'`).get() as { count: number };
    const artifactCount = db.prepare(`SELECT COUNT(*) AS count FROM generated_artifacts
      WHERE source_query_id=?`).get(payloads[0].data.resourceId) as { count: number };
    db.close();
    expect(queryCount.count).toBe(1);
    expect(artifactCount.count).toBe(1);
  });

  it("GET returns a persisted list", async () => {
    const req = authenticatedRequest("http://localhost/api/v1/data-queries");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.data.items)).toBe(true);
    expect(data.data.items).toEqual([]);
    expect(data.meta.pagination.limit).toBe(20);
  });
});
