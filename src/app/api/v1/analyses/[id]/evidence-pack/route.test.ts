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
  dbPath = join(tmpdir(), `money-whisperer-evidence-pack-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* SQLite can release handles after teardown. */ }
  }
});

describe("GET /api/v1/analyses/:id/evidence-pack", () => {
  it("reports unavailable market data, missing facts and a blocked publication gate", async () => {
    const userId = "evidence-pack-user";
    seedAuthenticatedUser({ userId });
    const db = getDatabase();
    db.prepare(`INSERT INTO agent_runs
      (id,user_id,type,status,agent_type,compliance_json,created_at,completed_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      "analysis-evidence", userId, "conversation_agent", "blocked", "chief_advisor",
      "{\"status\":\"BLOCKED\",\"reasons\":[\"缺少有效行情\"]}",
      "2026-07-25T08:00:00.000Z", "2026-07-25T08:00:03.000Z",
    );
    db.prepare(`INSERT INTO agent_runs
      (id,user_id,type,status,root_run_id,parent_run_id,agent_type,objective,created_at,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      "analysis-evidence-data", userId, "data_research", "failed", "analysis-evidence", "analysis-evidence",
      "data_research",
      "当前角色：DATA_RESEARCH 你是 Money Whisperer 的真实专业子 Agent。用户与服务端上下文：内部提示。已完成的上游发现：内部数据。",
      "2026-07-25T08:00:01.000Z", "2026-07-25T08:00:02.000Z",
    );
    const skill = db.prepare("SELECT id FROM skill_assets WHERE slug='pandadata-api'").get() as { id: string };
    db.prepare(`INSERT INTO skill_runs
      (id,skill_asset_id,agent_run_id,method_name,status,quality_status,error_code,error_message,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      "skill-run-pandadata", skill.id, "analysis-evidence-data", "get_us_daily", "failed", "unavailable",
      "PANDADATA_UNAVAILABLE", "行情服务不可用", "2026-07-25T08:00:02.000Z",
    );
    for (const evidence of [
      ["evidence-support", "support", "组合集中度较高"],
      ["evidence-counter", "counter", "缺少行情时不能确认回撤"],
      ["evidence-missing", "missing", "缺少 AAPL 最新价格与历史波动率"],
    ]) {
      db.prepare(`INSERT INTO evidence_items
        (id,user_id,agent_run_id,kind,stance,quality,title,summary,statement,source,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
        evidence[0], userId, "analysis-evidence-data", evidence[1] === "missing" ? "missing_data" : "market_fact",
        evidence[1], "low", evidence[2], evidence[2], evidence[2], "PANDADATA", "2026-07-25T08:00:02.000Z",
      );
    }
    db.prepare(`INSERT INTO recommendations
      (id,user_id,analysis_id,action,suitability,summary,position_range_json,add_conditions_json,reasons_json,counter_evidence_json,risks_json,alternatives_json,compliance_json,provenance_json,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "recommendation-evidence", userId, "analysis-evidence", "WATCH", "LOW", "行情不可用，暂不调整",
      "[]", "[]", "[]", "[\"缺少行情\"]", "[]", "[]", "{\"status\":\"BLOCKED\"}", "{}", "BLOCKED",
      "2026-07-25T08:00:03.000Z", "2026-07-25T08:00:03.000Z",
    );
    db.close();

    const response = await GET(
      authenticatedRequest("http://localhost/api/v1/analyses/analysis-evidence/evidence-pack", {}, { userId }),
      { params: Promise.resolve({ id: "analysis-evidence" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.dataFreshness.status).toBe("UNAVAILABLE");
    expect(body.data.missingEvidence).toEqual(expect.arrayContaining([
      "缺少可用市场行情。",
      "缺少 AAPL 最新价格与历史波动率",
      "部分证据缺少可追溯的数据来源。",
      "市场证据未提供数据时间。",
      "风险与合规发布门已阻断该建议。",
    ]));
    expect(body.data.retry).toEqual({
      allowed: false,
      reason: "该运行已完成或被阻断，请基于当前信息发起新的顾问分析。",
    });
    const dataResearchTrace = body.data.agentTrace.find((item: { agent: string }) => item.agent === "DATA_RESEARCH");
    expect(dataResearchTrace).toMatchObject({
      purpose: "核验市场数据、估值与资讯证据",
      inputSummary: "核验市场数据、估值与资讯证据",
    });
    expect(JSON.stringify(dataResearchTrace)).not.toContain("用户与服务端上下文");
    expect(JSON.stringify(dataResearchTrace)).not.toContain("已完成的上游发现");
  });
});
