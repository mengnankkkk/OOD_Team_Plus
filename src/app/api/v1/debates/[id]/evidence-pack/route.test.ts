import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticatedRequest, seedAuthenticatedUser, TEST_USER_ID } from "@tests/helpers/auth";
import { getDatabase } from "@/server/http/context";

import { GET } from "./route";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-debate-pack-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
  seedAuthenticatedUser();
  const db = getDatabase();
  db.prepare(`INSERT INTO conversation_sessions
    (id,user_id,title,status,created_at,updated_at,row_version)
    VALUES ('conversation_debate',?,'Battle','active','2026-07-25T00:00:00.000Z','2026-07-25T00:00:00.000Z',1)`).run(TEST_USER_ID);
  db.prepare(`INSERT INTO agent_runs
    (id,user_id,type,status,session_id,result_json,created_at,completed_at)
    VALUES ('analysis_debate',?,'debate_agent','completed','conversation_debate',?,'2026-07-25T00:00:00.000Z','2026-07-25T00:00:01.000Z')`).run(
    TEST_USER_ID,
    JSON.stringify({
      publication: {
        analysisId: "analysis_publication",
        status: "DEGRADED",
        direction: "HOLD",
        action: "WATCH",
        answer: "当前只适合观察。",
        recommendationId: null,
        missingInformation: [],
        provider: "CHIEF_ADVISOR",
      },
    }),
  );
  db.prepare(`INSERT INTO debate_sessions
    (id,user_id,conversation_id,root_agent_run_id,motion,user_debate_role,status,current_round_index,created_at,updated_at)
    VALUES ('debate_1',?,'conversation_debate','analysis_debate','是否加仓','neutral','active',1,'2026-07-25T00:00:00.000Z','2026-07-25T00:00:00.000Z')`).run(TEST_USER_ID);
  db.prepare(`INSERT INTO debate_rounds
    (id,debate_session_id,round_index,round_focus,user_intent,status,created_at,completed_at)
    VALUES ('round_1','debate_1',1,'估值 vs 趋势','ask_both','completed','2026-07-25T00:00:00.000Z','2026-07-25T00:00:01.000Z')`).run();
  db.prepare(`INSERT INTO debate_turns
    (id,debate_session_id,debate_round_id,speaker,stance,turn_type,content,public_summary,structured_payload_json,created_at)
    VALUES ('turn_bull','debate_1','round_1','bull','bull','opening','多方观点','多方摘要','{}','2026-07-25T00:00:00.000Z')`).run();
  db.prepare(`INSERT INTO debate_judgements
    (id,debate_session_id,debate_round_id,user_claim,bull_strongest_point,bear_strongest_point,key_disagreement,response_quality_json,evidence_tilt,confidence_decimal,why_not_final,suggested_next_prompts_json,compliance_note,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "judge_1",
    "debate_1",
    "round_1",
    "用户想加仓",
    "多方强点",
    "空方强点",
    "关键分歧",
    JSON.stringify({ bull: "direct", bear: "direct" }),
    "balanced",
    "0.55",
    "还缺证据",
    JSON.stringify(["继续追问"]),
    "仅研究",
    "2026-07-25T00:00:01.000Z",
  );
  db.close();
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
});

describe("GET /api/v1/debates/:id/evidence-pack", () => {
  it("returns debate rounds, turns, and judgement", async () => {
    const res = await GET(authenticatedRequest("http://localhost/api/v1/debates/debate_1/evidence-pack"), { params: Promise.resolve({ id: "debate_1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.turns[0].speaker).toBe("bull");
    expect(body.data.judgements[0].evidenceTilt).toBe("balanced");
    expect(body.data.judgements[0].responseQuality).toEqual({ bull: "direct", bear: "direct" });
    expect(body.data.publication).toMatchObject({ status: "DEGRADED", action: "WATCH" });
    expect(body.data.disclaimer).toContain("不构成交易指令");
  });
});
