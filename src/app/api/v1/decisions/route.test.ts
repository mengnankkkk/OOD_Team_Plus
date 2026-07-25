import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TEST_USER_ID, authenticatedRequest, seedAuthenticatedUser } from "@tests/helpers/auth";
import { getDatabase, isoNow } from "@/server/http/context";
import { POST as decide } from "../recommendations/[id]/decisions/route";
import { GET } from "./route";

const recommendationId = "recommendation-decision-log-test";
const conversationId = "conversation-decision-log-test";
const analysisId = "analysis-decision-log-test";
let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-decisions-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
  seedAuthenticatedUser();
  seedRecommendation();
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* Windows may release SQLite handles after teardown. */ }
  }
});

describe("decision log lifecycle", () => {
  it("persists a real recommendation snapshot and advisor context", async () => {
    const accepted = await postDecision("ACCEPT", "先用模拟组合观察回撤", "accept-decision");
    const acceptedBody = await accepted.json();

    expect(accepted.status).toBe(201);
    expect(acceptedBody.data.recommendationStatus).toBe("SIMULATED");

    const list = await GET(authenticatedRequest("http://localhost/api/v1/decisions?limit=20"));
    const body = await list.json();
    const item = body.data.items[0];

    expect(item.recommendationId).toBe(recommendationId);
    expect(item.action).toBe("simulated");
    expect(item.reason).toBe("先用模拟组合观察回撤");
    expect(item.userQuestion).toBe("科技板块现在适合入场吗？");
    expect(item.advisorReply).toContain("建议先试仓");
    expect(item.instrument).toMatchObject({ symbol: "AAPL", name: "Apple" });
    expect(item.recommendation).toMatchObject({ id: recommendationId, summary: "先试仓，不追高" });
    expect(item.currentStatus).toBe("SIMULATED");
  });

  it("revokes a simulated decision and restores the recommendation", async () => {
    await postDecision("ACCEPT", undefined, "accept-before-revoke");
    const revoked = await postDecision("REVOKE", "等待新的估值信号", "revoke-decision");
    const body = await revoked.json();

    expect(revoked.status).toBe(201);
    expect(body.data.recommendationStatus).toBe("ACTIVE");

    const db = getDatabase();
    const recommendation = db.prepare("SELECT status FROM recommendations WHERE id=?").get(recommendationId) as { status: string };
    const actions = db.prepare("SELECT action FROM decision_logs WHERE user_id=? ORDER BY created_at,id").all(TEST_USER_ID) as Array<{ action: string }>;
    db.close();
    expect(recommendation.status).toBe("ACTIVE");
    expect(actions.map((item) => item.action)).toEqual(["ACCEPT", "REVOKE"]);
  });

  it("filters current and legacy action aliases while preserving top-level snapshot links", async () => {
    const db = getDatabase();
    db.prepare(`INSERT INTO decision_logs
      (id,user_id,conversation_id,action,recommendation_json,decision,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      "legacy-simulated-decision",
      TEST_USER_ID,
      conversationId,
      "SIMULATED",
      JSON.stringify({
        recommendationId,
        analysisId,
        recommendation: { summary: "旧版模拟采纳记录" },
      }),
      "SIMULATED",
      "2026-07-25T08:00:00.000Z",
    );
    db.close();
    await postDecision("ACCEPT", "当前版本模拟采纳", "current-simulated-decision");

    const list = await GET(authenticatedRequest("http://localhost/api/v1/decisions?action=simulated&limit=20"));
    const body = await list.json();

    expect(body.data.items).toHaveLength(2);
    expect(body.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        recommendationId,
        analysisId,
        action: "simulated",
      }),
      expect.objectContaining({
        recommendationId,
        analysisId,
        action: "simulated",
        recommendation: { summary: "旧版模拟采纳记录" },
      }),
    ]));
  });
});

async function postDecision(action: "ACCEPT" | "REVOKE", reason: string | undefined, key: string) {
  return decide(
    authenticatedRequest(`http://localhost/api/v1/recommendations/${recommendationId}/decisions`, {
      method: "POST",
      body: JSON.stringify({ action, reason }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    }),
    { params: Promise.resolve({ id: recommendationId }) },
  );
}

function seedRecommendation() {
  const db = getDatabase();
  const now = isoNow();
  db.prepare("INSERT OR REPLACE INTO instruments (id,symbol,name,market,asset_type,tradable) VALUES ('AAPL','AAPL','Apple','US','stock',1)").run();
  db.prepare(`INSERT INTO conversation_sessions (id,user_id,title,status,created_at,updated_at,row_version)
    VALUES (?,?,'科技板块入场判断','active',?,?,1)`).run(conversationId, TEST_USER_ID, now, now);
  db.prepare("INSERT INTO agent_runs (id,user_id,type,status,created_at,completed_at) VALUES (?,?,'ADVISORY','completed',?,?)")
    .run(analysisId, TEST_USER_ID, now, now);
  db.prepare("INSERT INTO messages (id,session_id,role,content,created_at,metadata_json) VALUES ('decision-user-message',?,'user','科技板块现在适合入场吗？',?,'{}')")
    .run(conversationId, now);
  db.prepare("INSERT INTO messages (id,session_id,role,content,created_at,agent_run_id,metadata_json) VALUES ('decision-advisor-message',?,'assistant','建议先试仓，再根据估值和回撤条件分批增配。',?,?,'{}')")
    .run(conversationId, now, analysisId);
  db.prepare(`INSERT INTO recommendations
    (id,user_id,conversation_id,analysis_id,instrument_id,action,suitability,summary,confidence_decimal,
     position_range_json,first_position,add_conditions_json,reference_range_json,stop_loss,take_profit,horizon,expires_at,
     reasons_json,counter_evidence_json,risks_json,alternatives_json,invalidation,compliance_json,data_as_of,provenance_json,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'TRIAL_BUY','HIGH','先试仓，不追高','0.82','[0.05,0.10]','总资产的 5%','["估值回落后加仓"]','[170,190]',
      '跌破投资逻辑区间','达到目标估值后再平衡','MEDIUM','2099-12-31T00:00:00.000Z',
      '["估值处于历史中位"]','["行业波动仍然偏高"]','["短期回撤风险"]','["宽基 ETF"]','盈利逻辑显著恶化',
      '{"status":"PASSED"}',?,'{"provider":"pandadata"}','ACTIVE',?,?)`)
    .run(recommendationId, TEST_USER_ID, conversationId, analysisId, "AAPL", now, now, now);
  db.close();
}
