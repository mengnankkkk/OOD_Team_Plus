import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticatedRequest, seedAuthenticatedUser } from "@tests/helpers/auth";
import { getDatabase } from "@/server/http/context";
import { GET } from "./route";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-analysis-history-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* SQLite can release handles after teardown. */ }
  }
});

describe("GET /api/v1/analyses", () => {
  it("returns all user-owned root runs instead of deriving history from recommendations", async () => {
    const userId = "analysis-history-user";
    seedAuthenticatedUser({ userId });
    seedAuthenticatedUser({ userId: "other-analysis-user" });
    const db = getDatabase();
    db.prepare(`INSERT INTO agent_runs
      (id,user_id,type,status,root_run_id,agent_type,objective,output_summary,created_at,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      "analysis-blocked", userId, "conversation_agent", "blocked", "analysis-blocked", "chief_advisor",
      "生成今日组合建议", "行情不可用，建议维持观察", "2026-07-25T08:00:00.000Z", "2026-07-25T08:00:03.000Z",
    );
    db.prepare(`INSERT INTO agent_runs
      (id,user_id,type,status,agent_type,objective,output_summary,created_at,failure_code,failure_message)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      "analysis-failed", userId, "portfolio_refresh", "failed", "data_research",
      "刷新持仓行情", "行情刷新失败", "2026-07-25T07:00:00.000Z", "PANDADATA_UNAVAILABLE", "PandaData unavailable",
    );
    db.prepare(`INSERT INTO agent_runs
      (id,user_id,type,status,root_run_id,parent_run_id,agent_type,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      "analysis-child", userId, "profile_context", "completed", "analysis-blocked", "analysis-blocked", "profile_context", "2026-07-25T08:00:01.000Z",
    );
    db.prepare(`INSERT INTO agent_runs
      (id,user_id,type,status,created_at)
      VALUES (?,?,?,?,?)`).run(
      "analysis-other-user", "other-analysis-user", "conversation_agent", "completed", "2026-07-25T09:00:00.000Z",
    );
    db.prepare(`INSERT INTO recommendations
      (id,user_id,analysis_id,action,suitability,summary,position_range_json,add_conditions_json,reasons_json,counter_evidence_json,risks_json,alternatives_json,compliance_json,provenance_json,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "recommendation-blocked", userId, "analysis-blocked", "WATCH", "LOW", "行情不可用",
      "[]", "[]", "[]", "[\"缺少行情\"]", "[]", "[]", "{\"status\":\"BLOCKED\"}", "{}", "BLOCKED",
      "2026-07-25T08:00:03.000Z", "2026-07-25T08:00:03.000Z",
    );
    db.prepare(`INSERT INTO evidence_items
      (id,user_id,agent_run_id,kind,stance,quality,title,summary,source,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      "evidence-blocked", userId, "analysis-child", "market_fact", "counter", "low",
      "行情不可用", "实时行情未返回", "PANDADATA", "2026-07-25T08:00:02.000Z",
    );
    db.close();

    const response = await GET(authenticatedRequest("http://localhost/api/v1/analyses?limit=10", {}, { userId }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items.map((item: { id: string }) => item.id)).toEqual(["analysis-blocked", "analysis-failed"]);
    expect(body.data.items[0]).toMatchObject({
      id: "analysis-blocked",
      status: "BLOCKED",
      recommendationId: "recommendation-blocked",
      evidenceCount: 1,
      canRetry: false,
    });
    expect(body.data.items[1]).toMatchObject({
      id: "analysis-failed",
      status: "FAILED",
      canRetry: true,
      failure: { code: "PANDADATA_UNAVAILABLE" },
    });
  });
});
