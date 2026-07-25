import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticatedRequest, TEST_USER_ID } from "@tests/helpers/auth";
import { getDatabase } from "@/server/http/context";
import { RISK_QUESTIONS } from "@/lib/risk-assessment";
import { POST } from "./route";

let dbPath = "";

const answers = Object.fromEntries(RISK_QUESTIONS.map((question) => [question.id, question.options[1]?.value ?? question.options[0].value]));

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-onboarding-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* SQLite can release handles after teardown. */ }
  }
});

describe("/api/v1/onboarding/complete", () => {
  it("rejects an incomplete risk questionnaire", async () => {
    const response = await POST(authenticatedRequest("http://localhost/api/v1/onboarding/complete", {
      method: "POST",
      body: JSON.stringify({ answers: {}, profile: {}, goal: {} }),
      headers: { "Content-Type": "application/json" },
    }));

    expect(response.status).toBe(400);
  });

  it("persists risk assessment, profile, and the first goal atomically", async () => {
    const response = await POST(authenticatedRequest("http://localhost/api/v1/onboarding/complete", {
      method: "POST",
      body: JSON.stringify({
        answers,
        profile: {
          displayName: "测试用户",
          age: 28,
          household: "单身",
          monthlyIncome: "20000",
          monthlyExpense: "10000",
          liabilities: "0",
          emergencyTargetMonths: 6,
          investmentAmount: "50000",
          horizon: "LONG",
          maxDrawdown: "0.20",
        },
        goal: {
          name: "三年后购房首付",
          targetAmount: "300000",
          targetDate: "2029-12-31",
          priority: "1",
          assetPreference: "INDEX",
        },
      }),
      headers: { "Content-Type": "application/json" },
    }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.status).toBe("COMPLETE");
    expect(body.data.riskLevel).toMatch(/^R[1-5]$/u);

    const db = getDatabase();
    const profile = db.prepare("SELECT status, risk_level, investment_amount_decimal FROM user_profiles WHERE user_id=?").get(TEST_USER_ID) as Record<string, unknown>;
    const goal = db.prepare("SELECT name, target_amount_decimal FROM goals WHERE user_id=? AND status='active'").get(TEST_USER_ID) as Record<string, unknown>;
    const assessment = db.prepare("SELECT COUNT(*) AS count FROM risk_assessments WHERE user_id=?").get(TEST_USER_ID) as { count: number };
    db.close();

    expect(profile).toMatchObject({ status: "complete", risk_level: body.data.riskLevel, investment_amount_decimal: "50000" });
    expect(goal).toMatchObject({ name: "三年后购房首付", target_amount_decimal: "300000" });
    expect(assessment.count).toBe(1);
  });

  it("accepts browser-form numeric values and formatted money strings", async () => {
    const response = await POST(authenticatedRequest("http://localhost/api/v1/onboarding/complete", {
      method: "POST",
      body: JSON.stringify({
        answers,
        profile: {
          displayName: "格式化输入用户",
          age: "28",
          household: "",
          monthlyIncome: "20,000.00",
          monthlyExpense: "8,000",
          liabilities: 0,
          emergencyTargetMonths: "6",
          investmentAmount: "50,000",
          horizon: "LONG",
          maxDrawdown: 0.2,
        },
        goal: {
          name: "三年后购房首付",
          targetAmount: "300,000",
          targetDate: "2029-12-31",
          priority: "1",
          assetPreference: "INDEX",
        },
      }),
      headers: { "Content-Type": "application/json" },
    }));

    const body = await response.json();
    expect(response.status, JSON.stringify(body.error ?? body)).toBe(201);
  });
});
