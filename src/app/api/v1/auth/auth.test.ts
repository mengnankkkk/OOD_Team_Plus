import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getMe } from "./me/route";
import { POST as login } from "./login/route";
import { POST as logout } from "./logout/route";
import { POST as register } from "./register/route";
import { GET as listAdminUsers } from "../admin/users/route";
import { PATCH as updateAdminUser } from "../admin/users/[id]/route";
import { createSession, hashPassword } from "@/server/auth/service";
import { getDatabase, isoNow } from "@/server/http/context";

describe("username and password authentication", () => {
  beforeEach(() => {
    vi.stubEnv("ALLOW_REGISTRATION", "true");
    const db = getDatabase();
    db.exec("DELETE FROM api_sessions; DELETE FROM auth_rate_limits; DELETE FROM users;");
    db.close();
  });

  it("registers a normalized username and returns a usable hashed session", async () => {
    const response = await register(jsonRequest("http://localhost/api/v1/auth/register", {
      username: "Investor_01",
      password: "correct-horse-battery-staple",
      displayName: "Investor One",
    }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.user).toMatchObject({ username: "investor_01", role: "USER", status: "ACTIVE" });
    const cookie = sessionCookie(response);
    const me = await getMe(new NextRequest("http://localhost/api/v1/auth/me", { headers: { cookie } }));
    expect(me.status).toBe(200);
    expect((await me.json()).data.user.username).toBe("investor_01");

    const db = getDatabase();
    const stored = db.prepare("SELECT password_hash FROM users WHERE username_normalized='investor_01'").get() as { password_hash: string };
    const session = db.prepare("SELECT token_hash FROM api_sessions LIMIT 1").get() as { token_hash: string };
    db.close();
    expect(stored.password_hash).toMatch(/^\$argon2id\$/);
    expect(session.token_hash).not.toContain(cookie.split("=")[1]);
  });

  it("logs in case-insensitively and revokes the session on logout", async () => {
    await register(jsonRequest("http://localhost/api/v1/auth/register", { username: "case_user", password: "very-secure-password" }));
    const response = await login(jsonRequest("http://localhost/api/v1/auth/login", { username: "CASE_USER", password: "very-secure-password" }));
    expect(response.status).toBe(200);
    const cookie = sessionCookie(response);
    expect((await getMe(new NextRequest("http://localhost/api/v1/auth/me", { headers: { cookie } }))).status).toBe(200);
    expect((await logout(new NextRequest("http://localhost/api/v1/auth/logout", { method: "POST", headers: { cookie } }))).status).toBe(204);
    expect((await getMe(new NextRequest("http://localhost/api/v1/auth/me", { headers: { cookie } }))).status).toBe(401);
  });

  it("rejects ordinary users from admin APIs and protects the final administrator", async () => {
    const now = isoNow();
    const passwordHash = await hashPassword("administrator-password");
    const db = getDatabase();
    db.prepare(`INSERT INTO users
      (id,username,username_normalized,password_hash,display_name,role,status,force_password_change,created_at,updated_at,row_version)
      VALUES ('admin-1','admin_1','admin_1',?,'Admin','ADMIN','ACTIVE',0,?,?,1)`).run(passwordHash, now, now);
    db.prepare(`INSERT INTO users
      (id,username,username_normalized,password_hash,display_name,role,status,force_password_change,created_at,updated_at,row_version)
      VALUES ('user-1','user_1','user_1',?,'User','USER','ACTIVE',0,?,?,1)`).run(passwordHash, now, now);
    db.close();
    const admin = { id: "admin-1", username: "admin_1", displayName: "Admin", role: "ADMIN" as const, status: "ACTIVE" as const, forcePasswordChange: false, createdAt: now, updatedAt: now, version: 1 };
    const user = { ...admin, id: "user-1", username: "user_1", role: "USER" as const };
    const adminCookie = `mw_session=${createSession(admin, {}).token}`;
    const userCookie = `mw_session=${createSession(user, {}).token}`;

    expect((await listAdminUsers(new NextRequest("http://localhost/api/v1/admin/users", { headers: { cookie: userCookie } }))).status).toBe(403);
    const demotion = await updateAdminUser(
      new NextRequest("http://localhost/api/v1/admin/users/admin-1", { method: "PATCH", headers: { cookie: adminCookie, "if-match": "1", "content-type": "application/json" }, body: JSON.stringify({ role: "USER" }) }),
      { params: Promise.resolve({ id: "admin-1" }) },
    );
    expect(demotion.status).toBe(409);
    expect((await demotion.json()).error.code).toBe("LAST_ADMIN_PROTECTED");
  });
});

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": crypto.randomUUID() }, body: JSON.stringify(body) });
}

function sessionCookie(response: Response): string {
  const match = response.headers.get("set-cookie")?.match(/mw_session=([^;]+)/);
  if (!match) throw new Error("Session cookie was not returned");
  return `mw_session=${match[1]}`;
}
