import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticatedRequest, TEST_USER_ID } from "@tests/helpers/auth";
import { getDatabase } from "@/server/http/context";
import { PATCH } from "./route";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-locale-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* SQLite can release handles after teardown. */ }
  }
});

describe("PATCH /api/v1/profile/locale", () => {
  it("persists the account locale, cookie, and response language together", async () => {
    const response = await PATCH(authenticatedRequest("http://localhost/api/v1/profile/locale", {
      method: "PATCH",
      headers: { "content-type": "application/json", "accept-language": "zh-CN", cookie: "mw_locale=zh-CN" },
      body: JSON.stringify({ locale: "en-US" }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-language")).toBe("en-US");
    expect(response.headers.get("set-cookie")).toContain("mw_locale=en-US");
    const db = getDatabase();
    const row = db.prepare("SELECT preferred_locale FROM users WHERE id=?").get(TEST_USER_ID) as { preferred_locale: string };
    db.close();
    expect(row.preferred_locale).toBe("en-US");
  });

  it("rejects unsupported locale values with a stable validation code", async () => {
    const response = await PATCH(authenticatedRequest("http://localhost/api/v1/profile/locale", {
      method: "PATCH",
      headers: { "content-type": "application/json", "accept-language": "en-US" },
      body: JSON.stringify({ locale: "ja-JP" }),
    }));

    expect(response.status).toBe(422);
    expect(response.headers.get("content-language")).toBe("en-US");
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
  });
});
