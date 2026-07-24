import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/extensions/security/public-url", () => ({
  assertPublicHttpUrl: vi.fn(async (value: string) => {
    const url = new URL(value);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") throw new Error("Private URL");
    return url;
  }),
}));

import { DELETE, PATCH } from "./[id]/route";
import { GET, POST } from "./route";
import { getDatabase, hashSessionToken, isoNow } from "@/server/http/context";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-rss-admin-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* SQLite can release Windows handles after test teardown. */ }
  }
});

describe("/api/v1/admin/rss/feeds", () => {
  it("requires an idempotency key", async () => {
    const response = await POST(new NextRequest("http://localhost/api/v1/admin/rss/feeds", {
      method: "POST",
      body: JSON.stringify({ feedUrl: "https://example.com/feed.xml" }),
    }));
    expect(response.status).toBe(400);
  });

  it("blocks SSRF URLs", async () => {
    const response = await POST(new NextRequest("http://localhost/api/v1/admin/rss/feeds", {
      method: "POST",
      body: JSON.stringify({ feedUrl: "http://127.0.0.1/feed" }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "rss-ssrf-1" },
    }));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("UNSAFE_SOURCE_URL");
  });

  it("creates, updates and soft-deletes a feed with version checks", async () => {
    const created = await POST(new NextRequest("http://localhost/api/v1/admin/rss/feeds", {
      method: "POST",
      body: JSON.stringify({ name: "财经资讯", feedUrl: "https://example.com/feed.xml", siteUrl: "https://example.com", enabled: true, refreshIntervalMinutes: 30 }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "rss-create-1" },
    }));
    const createdBody = await created.json();
    expect(created.status).toBe(201);
    expect(createdBody.data).toMatchObject({ name: "财经资讯", status: "ACTIVE", version: 1 });
    const feedId = createdBody.data.id as string;

    const updated = await PATCH(
      new NextRequest(`http://localhost/api/v1/admin/rss/feeds/${feedId}`, { method: "PATCH", body: JSON.stringify({ name: "市场资讯" }), headers: { "Content-Type": "application/json", "If-Match": "1" } }),
      { params: Promise.resolve({ id: feedId }) },
    );
    expect(updated.status).toBe(200);
    expect((await updated.json()).data).toMatchObject({ name: "市场资讯", version: 2 });

    const stale = await PATCH(
      new NextRequest(`http://localhost/api/v1/admin/rss/feeds/${feedId}`, { method: "PATCH", body: JSON.stringify({ name: "旧版本" }), headers: { "Content-Type": "application/json", "If-Match": "1" } }),
      { params: Promise.resolve({ id: feedId }) },
    );
    expect(stale.status).toBe(412);

    const deleted = await DELETE(
      new NextRequest(`http://localhost/api/v1/admin/rss/feeds/${feedId}`, { method: "DELETE", headers: { "If-Match": "2" } }),
      { params: Promise.resolve({ id: feedId }) },
    );
    expect(deleted.status).toBe(204);
    const listed = await GET(new NextRequest("http://localhost/api/v1/admin/rss/feeds"));
    expect((await listed.json()).data.items).toEqual([]);
  });

  it("hides admin resources from non-demo users", async () => {
    const token = "non-admin-token";
    const now = isoNow();
    const db = getDatabase();
    db.prepare("INSERT INTO users (id,display_name,created_at) VALUES ('regular-user','Regular',?)").run(now);
    db.prepare("INSERT INTO api_sessions (id,user_id,token_hash,expires_at,created_at,last_seen_at) VALUES ('regular-session','regular-user',?,?,?,?)").run(hashSessionToken(token), "2099-01-01T00:00:00.000Z", now, now);
    db.close();
    const response = await GET(new NextRequest("http://localhost/api/v1/admin/rss/feeds", { headers: { Cookie: `mw_session=${token}` } }));
    expect(response.status).toBe(404);
  });
});
