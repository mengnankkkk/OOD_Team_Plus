import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TEST_USER_ID, authenticatedRequest, seedAuthenticatedUser } from "@tests/helpers/auth";
import { POST as answerClarification } from "../clarifications/[clarificationId]/answer/route";
import { GET as listClarifications } from "../clarifications/route";
import { POST } from "./route";
import { getDatabase, isoNow } from "@/server/http/context";

const conversationId = "conversation-advisor-test";
let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-advisor-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
  vi.stubEnv("DEEPSEEK_API_KEY", "");
  seedAuthenticatedUser();
  const db = getDatabase();
  const now = isoNow();
  db.prepare("INSERT INTO conversation_sessions (id,user_id,title,status,created_at,updated_at,row_version) VALUES (?,?,'Advisor test','active',?,?,1)").run(conversationId, TEST_USER_ID, now, now);
  db.close();
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* SQLite can release Windows handles after test teardown. */ }
  }
});

describe("conversation advisor clarifications", () => {
  it("creates profile questions and resumes analysis after answers", async () => {
    const initial = await sendMessage("我想买入 AAPL", "profile-message");
    const initialBody = await initial.json();
    expect(initial.status).toBe(202);
    expect(initialBody.data.analysis.status).toBe("WAITING_FOR_USER");

    const pending = await listClarifications(
      authenticatedRequest(`http://localhost/api/v1/conversations/${conversationId}/clarifications?status=PENDING`),
      { params: Promise.resolve({ id: conversationId }) },
    );
    const pendingBody = await pending.json();
    expect(pendingBody.data.items[0].fields.map((field: { key: string }) => field.key)).toEqual(expect.arrayContaining([
      "riskLevel", "investmentAmount", "holdingPeriod", "maxDrawdown", "instrumentPreference", "nearTermUse",
    ]));

    const clarificationId = initialBody.data.clarificationId as string;
    const answered = await answerClarification(
      authenticatedRequest(`http://localhost/api/v1/conversations/${conversationId}/clarifications/${clarificationId}/answer`, {
        method: "POST",
        body: JSON.stringify({ answers: { riskLevel: "BALANCED", investmentAmount: "20000", holdingPeriod: "LONG", maxDrawdown: "0.12", instrumentPreference: "SECTOR_ETF", nearTermUse: false } }),
        headers: { "Content-Type": "application/json", "Idempotency-Key": "answer-profile" },
      }),
      { params: Promise.resolve({ id: conversationId, clarificationId }) },
    );
    const answeredBody = await answered.json();
    expect(answered.status).toBe(202);
    expect(answeredBody.data.result.analysis.status).toBe("COMPLETED");
    expect(answeredBody.data.result.recommendationId).toBeTruthy();

    const db = getDatabase();
    const profile = db.prepare("SELECT * FROM user_profiles WHERE user_id=?").get(TEST_USER_ID) as Record<string, unknown>;
    db.close();
    expect(profile.risk_level).toBe("BALANCED");
    expect(profile.horizon).toBe("LONG");
  });

  it("adds a clarified instrument to the resumed question", async () => {
    createCompleteProfile();
    const initial = await sendMessage("现在适合买入吗", "instrument-message");
    const initialBody = await initial.json();
    expect(initialBody.data.missingQuestions).toEqual(["请说明要分析的股票、基金或指数代码。"]);

    const clarificationId = initialBody.data.clarificationId as string;
    const answered = await answerClarification(
      authenticatedRequest(`http://localhost/api/v1/conversations/${conversationId}/clarifications/${clarificationId}/answer`, {
        method: "POST",
        body: JSON.stringify({ answers: { instrument: "AAPL" } }),
        headers: { "Content-Type": "application/json", "Idempotency-Key": "answer-instrument" },
      }),
      { params: Promise.resolve({ id: conversationId, clarificationId }) },
    );
    const body = await answered.json();
    expect(answered.status).toBe(202);
    expect(body.data.result.analysis.status).toBe("COMPLETED");
    expect(body.data.result.recommendationId).toBeTruthy();
  });

  it("returns RUN_ALREADY_ACTIVE for a duplicate processing message", async () => {
    const db = getDatabase();
    const now = isoNow();
    db.prepare("INSERT INTO agent_runs (id,user_id,type,status,created_at) VALUES ('active-run',?,'conversation_agent','running',?)").run(TEST_USER_ID, now);
    db.prepare("INSERT INTO messages (id,session_id,role,content,created_at,client_message_id,agent_run_id,metadata_json) VALUES ('active-message',?,'user','处理中',?,'processing-message','active-run','{}')").run(conversationId, now);
    db.close();

    const response = await sendMessage("处理中", "processing-message");
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error.code).toBe("RUN_ALREADY_ACTIVE");
  });

  it("keeps open-ended normal conversations in guided intake without generating a recommendation", async () => {
    createCompleteProfile();
    const response = await sendMessage("我 28 岁，存款 15 万，怕股票暴跌，想学理财", "guided-intake-message");
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.data.analysis.status).toBe("COMPLETED");
    expect(body.data.conversationKind).toBe("GUIDED_INTAKE");
    expect(body.data.recommendationId).toBeNull();
    expect(body.data.answer).toContain("普通模式会先把目标、资金用途和风险边界聊清楚");

    const db = getDatabase();
    const recommendationCount = db.prepare("SELECT COUNT(*) AS count FROM recommendations WHERE user_id=?").get(TEST_USER_ID) as { count: number };
    db.close();
    expect(recommendationCount.count).toBe(0);
  });
});

async function sendMessage(content: string, clientMessageId: string) {
  return POST(
    authenticatedRequest(`http://localhost/api/v1/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, clientMessageId }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": `idem-${clientMessageId}` },
    }),
    { params: Promise.resolve({ id: conversationId }) },
  );
}

function createCompleteProfile() {
  const db = getDatabase();
  const now = isoNow();
  db.prepare(`INSERT INTO user_profiles
    (id,user_id,risk_level,investment_amount_decimal,horizon,max_drawdown_decimal,preferences_json,status,version,created_at,updated_at)
    VALUES ('profile-test',?,'BALANCED','20000','LONG','0.12',?,'completed',1,?,?)`).run(TEST_USER_ID, JSON.stringify({ instrumentPreference: "STOCK", nearTermUse: false }), now, now);
  db.close();
}
