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
  dbPath = join(tmpdir(), `money-whisperer-evidence-preview-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* SQLite can release handles after teardown. */ }
  }
});

describe("GET /api/v1/analyses/:id/evidence-pack preview data", () => {
  it("falls back to profile and tool verification time instead of exposing missing timestamps", async () => {
    const userId = "evidence-profile-time-user";
    seedAuthenticatedUser({ userId });
    const db = getDatabase();
    db.prepare(`INSERT INTO user_profiles
      (id,user_id,risk_level,preferences_json,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      "profile-time", userId, "R2", "{}", "completed",
      "2026-07-25T07:45:00.000Z", "2026-07-25T08:10:00.000Z",
    );
    db.prepare(`INSERT INTO agent_runs
      (id,user_id,type,status,agent_type,created_at,completed_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      "analysis-profile-time", userId, "conversation_agent", "completed", "chief_advisor",
      "2026-07-25T08:30:00.000Z", "2026-07-25T08:30:05.000Z",
    );
    db.prepare(`INSERT INTO agent_runs
      (id,user_id,type,status,root_run_id,parent_run_id,agent_type,created_at,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      "analysis-profile-time-profile", userId, "profile_context", "completed", "analysis-profile-time", "analysis-profile-time",
      "profile_context", "2026-07-25T08:30:01.000Z", "2026-07-25T08:30:02.000Z",
    );
    db.prepare(`INSERT INTO agent_runs
      (id,user_id,type,status,root_run_id,parent_run_id,agent_type,created_at,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      "analysis-profile-time-data", userId, "data_research", "failed", "analysis-profile-time", "analysis-profile-time",
      "data_research", "2026-07-25T08:30:02.000Z", "2026-07-25T08:30:03.000Z",
    );
    const skill = db.prepare("SELECT id FROM skill_assets WHERE slug='pandadata-api'").get() as { id: string };
    db.prepare(`INSERT INTO tool_calls
      (id,agent_run_id,data_source_id,tool_name,tool_version,status,arguments_json,error_code,error_message,started_at,completed_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "tool-profile-time", "analysis-profile-time-data", "source-pandadata-api", "pandadata", "0.0.12", "failed",
      "{}", "PANDADATA_UNAVAILABLE", "行情源调用失败",
      "2026-07-25T08:30:02.200Z", "2026-07-25T08:30:03.000Z", "2026-07-25T08:30:02.200Z",
    );
    db.prepare(`INSERT INTO skill_runs
      (id,skill_asset_id,agent_run_id,tool_call_id,data_source_id,method_name,status,quality_status,started_at,completed_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      "skill-profile-time", skill.id, "analysis-profile-time-data", "tool-profile-time", "source-pandadata-api", "get_stock_daily", "failed", "unavailable",
      "2026-07-25T08:30:02.200Z", "2026-07-25T08:30:03.000Z", "2026-07-25T08:30:02.200Z",
    );
    db.prepare(`INSERT INTO pandadata_probes
      (id,agent_run_id,tool_call_id,skill_run_id,method_name,phase,status,duration_ms,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      "probe-profile-time", "analysis-profile-time-data", "tool-profile-time", "skill-profile-time", "get_stock_daily",
      "live_call", "failed", 800, "2026-07-25T08:30:03.100Z",
    );
    for (const item of [
      ["evidence-profile-time", "analysis-profile-time-profile", "model_inference", "support", "画像约束已经确认"],
      ["evidence-data-time", "analysis-profile-time-data", "market_fact", "counter", "行情源调用失败"],
    ]) {
      db.prepare(`INSERT INTO evidence_items
        (id,user_id,agent_run_id,kind,stance,quality,title,summary,statement,source,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
        item[0], userId, item[1], item[2], item[3], "medium", item[4], item[4], item[4],
        item[2] === "market_fact" ? "PANDADATA" : "DERIVED_ENGINE", "2026-07-25T08:30:04.000Z",
      );
    }
    db.close();

    const response = await GET(
      authenticatedRequest("http://localhost/api/v1/analyses/analysis-profile-time/evidence-pack", {}, { userId }),
      { params: Promise.resolve({ id: "analysis-profile-time" }) },
    );
    const body = await response.json();

    expect(body.data.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "evidence-profile-time",
        dataAsOf: "2026-07-25T08:10:00.000Z",
        timeBasis: "PROFILE_SNAPSHOT",
      }),
      expect.objectContaining({
        id: "evidence-data-time",
        dataAsOf: "2026-07-25T08:30:03.000Z",
        timeBasis: "SOURCE_VERIFIED",
      }),
    ]));
    expect(body.data.skillRuns).toEqual([expect.objectContaining({
      id: "skill-profile-time",
      dataAsOf: "2026-07-25T08:30:03.000Z",
      timeBasis: "SOURCE_VERIFIED",
    })]);
    expect(body.data.pandadataProbes).toEqual([expect.objectContaining({
      id: "probe-profile-time",
      dataAsOf: "2026-07-25T08:30:03.100Z",
      timeBasis: "SOURCE_VERIFIED",
    })]);
  });

  it("adds a non-empty recommendation simulation preview for report pages", async () => {
    const userId = "evidence-simulation-user";
    seedAuthenticatedUser({ userId });
    const db = getDatabase();
    db.prepare(`INSERT INTO agent_runs
      (id,user_id,type,status,agent_type,created_at,completed_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      "analysis-simulation", userId, "conversation_agent", "completed", "chief_advisor",
      "2026-07-25T09:30:00.000Z", "2026-07-25T09:30:05.000Z",
    );
    db.prepare("INSERT OR REPLACE INTO instruments (id,symbol,name,market,asset_type,sector,tradable) VALUES ('AAPL','AAPL','Apple','US','stock','Technology',1)").run();
    db.prepare(`INSERT INTO portfolio_snapshots
      (id,user_id,portfolio_id,cash_decimal,total_market_value_decimal,data_quality,source_statuses_json,as_of,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      "portfolio-simulation", userId, "portfolio-simulation", "1000", "9000", "complete", "[]",
      "2026-07-25T09:20:00.000Z", "2026-07-25T09:20:00.000Z",
    );
    db.prepare(`INSERT INTO holding_snapshots
      (id,portfolio_snapshot_id,instrument_id,quantity_decimal,cost_decimal,price_decimal,market_value_decimal,unrealized_pnl_decimal,weight_bps,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      "holding-simulation", "portfolio-simulation", "AAPL", "30", "250", "300", "9000", "1500", 10000,
      "2026-07-25T09:20:00.000Z",
    );
    db.prepare(`INSERT INTO recommendations
      (id,user_id,analysis_id,instrument_id,action,suitability,summary,position_range_json,add_conditions_json,reasons_json,counter_evidence_json,risks_json,alternatives_json,invalidation,compliance_json,provenance_json,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "recommendation-simulation", userId, "analysis-simulation", "AAPL", "SCALE_OUT", "MEDIUM", "分批降低 AAPL 集中度",
      "[\"40%\",\"60%\"]", "[]", "[\"组合风险 Agent 认为单一持仓过高\"]",
      "[\"AAPL 若继续上涨会少获得部分收益\"]", "[\"减仓节奏过快\"]", "[]", "市场环境改变",
      "{\"status\":\"PASSED\"}", "{\"snapshotId\":\"portfolio-simulation\"}", "ACTIVE",
      "2026-07-25T09:30:05.000Z", "2026-07-25T09:30:05.000Z",
    );
    db.close();

    const response = await GET(
      authenticatedRequest("http://localhost/api/v1/analyses/analysis-simulation/evidence-pack", {}, { userId }),
      { params: Promise.resolve({ id: "analysis-simulation" }) },
    );
    const body = await response.json();

    expect(body.data.simulationPreview).toEqual(expect.objectContaining({
      source: "RECOMMENDATION_PREVIEW",
      before: expect.objectContaining({
        concentration: expect.any(Number),
        drawdown: expect.any(Number),
        emergency_months: expect.any(Number),
      }),
      after: expect.objectContaining({
        concentration: expect.any(Number),
        drawdown: expect.any(Number),
        emergency_months: expect.any(Number),
      }),
    }));
    expect(body.data.simulationPreview.after.drawdown).toBeLessThan(body.data.simulationPreview.before.drawdown);
  });
});
