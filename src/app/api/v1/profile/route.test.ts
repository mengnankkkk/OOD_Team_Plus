import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticatedRequest, TEST_USER_ID } from "@tests/helpers/auth";
import { getDatabase, isoNow } from "@/server/http/context";
import { GET, PATCH } from "./route";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-profile-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* SQLite can release handles after teardown. */ }
  }
});

function seedLegacyProfile(preferences: Record<string, unknown>) {
  const request = authenticatedRequest("http://localhost/api/v1/profile");
  const now = isoNow();
  const db = getDatabase();
  db.prepare(`INSERT INTO user_profiles
    (id,user_id,risk_level,investment_amount_decimal,horizon,max_drawdown_decimal,preferences_json,status,version,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    "profile-test",
    TEST_USER_ID,
    "R4",
    "50000",
    "LONG",
    "0.20",
    JSON.stringify(preferences),
    "complete",
    1,
    now,
    now,
  );
  db.prepare(`INSERT INTO goals
    (id,user_id,name,target_amount_decimal,target_date,horizon,priority,asset_preference,status,version,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "goal-test",
    TEST_USER_ID,
    "长期投资",
    "300000",
    "2029-12-31",
    "LONG",
    "1",
    "INDEX",
    "active",
    1,
    now,
    now,
  );
  db.close();
  return request;
}

describe("/api/v1/profile", () => {
  it("requires legacy completed users to supplement suitability answers", async () => {
    const response = await GET(seedLegacyProfile({ onboardingCompleted: true }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.onboardingCompleted).toBe(false);
  });

  it("marks a profile complete only after all advisor suitability answers are present", async () => {
    const response = await GET(seedLegacyProfile({
      instrumentPreference: "INDEX",
      nearTermUse: false,
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.onboardingCompleted).toBe(true);
  });

  it("treats null suitability answers as incomplete", async () => {
    const response = await GET(seedLegacyProfile({
      instrumentPreference: null,
      nearTermUse: null,
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.onboardingCompleted).toBe(false);
  });

  it("localizes invalid profile updates", async () => {
    const response = await PATCH(authenticatedRequest("http://localhost/api/v1/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json", "accept-language": "en-US", cookie: "mw_locale=en-US" },
      body: JSON.stringify({ riskLevel: "INVALID" }),
    }));

    expect(response.status).toBe(422);
    expect(response.headers.get("content-language")).toBe("en-US");
    expect((await response.json()).error.message).toBe("The request parameters are invalid.");
  });
});
