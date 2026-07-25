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
      (id,skill_asset_id,agent_run_id,method_name,status,quality_status,error_code,error_message,started_at,completed_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      "skill-run-pandadata", skill.id, "analysis-evidence-data", "get_us_daily", "failed", "unavailable",
      "PANDADATA_UNAVAILABLE", "行情服务不可用",
      "2026-07-25T08:00:01.200Z", "2026-07-25T08:00:02.000Z", "2026-07-25T08:00:01.200Z",
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
    db.prepare(`INSERT INTO evidence_items
      (id,user_id,agent_run_id,kind,stance,quality,title,summary,statement,source,source_url,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "evidence-research", userId, "analysis-evidence-data", "research_fact", "support", "medium",
      "AAPL 业绩公告", "公司发布最新业绩公告", "公司发布最新业绩公告", "WEB", "https://example.com/aapl-earnings",
      "2026-07-25T08:00:02.000Z",
    );
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
      "风险与合规发布门已阻断该建议。",
    ]));
    expect(body.data.missingEvidence).not.toContain("市场证据未提供数据时间。");
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
    expect(body.data.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "evidence-counter",
        dataAsOf: "2026-07-25T08:00:02.000Z",
        timeBasis: "SOURCE_VERIFIED",
      }),
      expect.objectContaining({
        id: "evidence-missing",
        dataAsOf: "2026-07-25T08:00:02.000Z",
        timeBasis: "EVIDENCE_CREATED",
      }),
      expect.objectContaining({
        id: "evidence-research",
        sources: [expect.objectContaining({
          type: "PUBLIC_RESEARCH",
          reference: "https://example.com/aapl-earnings",
        })],
      }),
    ]));
  });

  it("restores historical evidence time from linked market and portfolio snapshots", async () => {
    const userId = "evidence-time-user";
    seedAuthenticatedUser({ userId });
    const db = getDatabase();
    db.prepare(`INSERT INTO agent_runs
      (id,user_id,type,status,agent_type,created_at,completed_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      "analysis-time", userId, "conversation_agent", "completed", "chief_advisor",
      "2026-07-25T09:00:00.000Z", "2026-07-25T09:00:05.000Z",
    );
    db.prepare(`INSERT INTO agent_runs
      (id,user_id,type,status,root_run_id,parent_run_id,agent_type,created_at,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      "analysis-time-data", userId, "data_research", "completed", "analysis-time", "analysis-time",
      "data_research", "2026-07-25T09:00:01.000Z", "2026-07-25T09:00:02.000Z",
    );
    db.prepare(`INSERT INTO agent_runs
      (id,user_id,type,status,root_run_id,parent_run_id,agent_type,created_at,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      "analysis-time-risk", userId, "portfolio_risk", "completed", "analysis-time", "analysis-time",
      "portfolio_risk", "2026-07-25T09:00:02.000Z", "2026-07-25T09:00:03.000Z",
    );
    db.prepare("INSERT OR REPLACE INTO instruments (id,symbol,name,market,asset_type,tradable) VALUES ('AAPL','AAPL','Apple','US','stock',1)").run();
    db.prepare(`INSERT INTO portfolio_snapshots
      (id,user_id,portfolio_id,cash_decimal,total_market_value_decimal,data_quality,source_statuses_json,as_of,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      "portfolio-snapshot-time", userId, "portfolio-time", "1000", "310", "complete", "[]",
      "2026-07-25T08:55:00.000Z", "2026-07-25T08:55:00.000Z",
    );
    db.prepare(`INSERT INTO market_snapshots
      (id,instrument_id,data_source_id,snapshot_type,as_of,trading_date,market_timezone,freshness_status,quality_status,source_method,source_parameters_json,raw_payload_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "market-snapshot-time", "AAPL", "source-pandadata-api", "quote", "2026-07-25T08:59:00.000Z",
      "2026-07-25", "America/New_York", "fresh", "valid", "get_us_daily", "{}", "{}", "2026-07-25T09:00:01.500Z",
    );
    for (const item of [
      ["evidence-market-time", "analysis-time-data", "market_fact", "support", "行情支持"],
      ["evidence-portfolio-time", "analysis-time-risk", "model_inference", "support", "组合集中度"],
    ]) {
      db.prepare(`INSERT INTO evidence_items
        (id,user_id,agent_run_id,kind,stance,quality,title,summary,statement,source,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
        item[0], userId, item[1], item[2], item[3], "high", item[4], item[4], item[4],
        item[2] === "market_fact" ? "PANDADATA" : "DERIVED_ENGINE", "2026-07-25T09:00:03.000Z",
      );
    }
    db.prepare(`INSERT INTO evidence_source_links
      (id,evidence_id,data_source_id,market_snapshot_id,source_locator,excerpt,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      "evidence-link-time", "evidence-market-time", "source-pandadata-api", "market-snapshot-time",
      "get_us_daily", "行情支持", "2026-07-25T09:00:03.000Z",
    );
    db.close();

    const response = await GET(
      authenticatedRequest("http://localhost/api/v1/analyses/analysis-time/evidence-pack", {}, { userId }),
      { params: Promise.resolve({ id: "analysis-time" }) },
    );
    const body = await response.json();

    expect(body.data.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "evidence-market-time",
        dataAsOf: "2026-07-25T08:59:00.000Z",
        timeBasis: "MARKET_DATA",
        sources: [expect.objectContaining({
          dataAsOf: "2026-07-25T08:59:00.000Z",
          timeBasis: "MARKET_DATA",
        })],
      }),
      expect.objectContaining({
        id: "evidence-portfolio-time",
        dataAsOf: "2026-07-25T08:55:00.000Z",
        timeBasis: "PORTFOLIO_SNAPSHOT",
      }),
    ]));
  });
});
