import { createHash, randomBytes } from "node:crypto";

import argon2 from "argon2";

import { createId, getDatabase, hashSessionToken, isoNow } from "@/server/http/context";

import { AuthFailure, type AuthUser, type UserRole, type UserStatus } from "./contracts";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const ARGON_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  status: UserStatus;
  force_password_change: number;
  created_at: string;
  updated_at: string | null;
  row_version: number;
  password_hash?: string | null;
};

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export async function registerUser(input: { username: string; password: string; displayName?: string }) {
  if (process.env.ALLOW_REGISTRATION?.toLowerCase() === "false") {
    throw new AuthFailure("REGISTRATION_DISABLED", 403, "Registration is disabled");
  }
  const db = getDatabase();
  const now = isoNow();
  const username = input.username.toLowerCase();
  const existing = db.prepare("SELECT id FROM users WHERE username_normalized=?").get(username);
  if (existing) {
    db.close();
    throw new AuthFailure("USERNAME_EXISTS", 409, "Username is already registered");
  }
  const passwordHash = await hashPassword(input.password);
  const id = createId("user");
  try {
    db.prepare(`INSERT INTO users
      (id,username,username_normalized,password_hash,display_name,role,status,force_password_change,password_changed_at,created_at,updated_at,row_version)
      VALUES (?,?,?,?,?,'USER','ACTIVE',0,?,?,?,1)`).run(
      id, username, username, passwordHash, input.displayName?.trim() || username, now, now, now,
    );
    const row = db.prepare("SELECT * FROM users WHERE id=?").get(id) as UserRow;
    return toAuthUser(row);
  } finally {
    db.close();
  }
}

export async function authenticateUser(usernameInput: string, password: string): Promise<AuthUser> {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM users WHERE username_normalized=? AND deleted_at IS NULL").get(usernameInput.toLowerCase()) as UserRow | undefined;
  db.close();
  if (!row?.password_hash || !(await verifyPassword(row.password_hash, password))) {
    throw new AuthFailure("INVALID_CREDENTIALS", 401, "Invalid username or password");
  }
  if (row.status !== "ACTIVE") throw new AuthFailure("ACCOUNT_DISABLED", 403, "Account is disabled");
  return toAuthUser(row);
}

export function createSession(user: AuthUser, metadata: { userAgent?: string | null; ip?: string | null }) {
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(24).toString("base64url");
  const sessionId = createId("session");
  const now = isoNow();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  const db = getDatabase();
  db.prepare(`INSERT INTO api_sessions
    (id,user_id,token_hash,csrf_token_hash,expires_at,created_at,last_seen_at,user_agent_hash,ip_hash)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    sessionId, user.id, hashSessionToken(token), sha256(csrfToken), expiresAt, now, now,
    metadata.userAgent ? sha256(metadata.userAgent) : null,
    metadata.ip ? sha256(metadata.ip) : null,
  );
  db.close();
  return { token, csrfToken, sessionId, expiresAt, maxAge: SESSION_MAX_AGE_SECONDS };
}

export function revokeSession(token: string | undefined): void {
  if (!token) return;
  const db = getDatabase();
  db.prepare("UPDATE api_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL").run(isoNow(), hashSessionToken(token));
  db.close();
}

export function enforceFixedWindowRateLimit(input: { scope: string; subject: string; limit: number; windowSeconds: number }): void {
  const nowMs = Date.now();
  const windowMs = input.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(nowMs / windowMs) * windowMs).toISOString();
  const subjectHash = sha256(input.subject);
  const db = getDatabase();
  const id = createId("rate");
  const now = isoNow();
  db.prepare(`INSERT INTO auth_rate_limits
    (id,scope,subject_hash,window_started_at,hit_count,updated_at)
    VALUES (?,?,?,?,1,?)
    ON CONFLICT(scope,subject_hash,window_started_at)
    DO UPDATE SET hit_count=auth_rate_limits.hit_count+1,updated_at=excluded.updated_at`).run(
    id, input.scope, subjectHash, windowStart, now,
  );
  const row = db.prepare(`SELECT hit_count FROM auth_rate_limits
    WHERE scope=? AND subject_hash=? AND window_started_at=?`).get(
    input.scope, subjectHash, windowStart,
  ) as { hit_count: number };
  db.close();
  if (row.hit_count > input.limit) {
    throw new AuthFailure("RATE_LIMITED", 429, "Too many requests; try again later");
  }
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const db = getDatabase();
  const row = db.prepare("SELECT password_hash FROM users WHERE id=? AND status='ACTIVE'").get(userId) as { password_hash?: string } | undefined;
  if (!row?.password_hash || !(await verifyPassword(row.password_hash, currentPassword))) {
    db.close();
    throw new AuthFailure("INVALID_CREDENTIALS", 401, "Current password is incorrect");
  }
  const passwordHash = await hashPassword(newPassword);
  const now = isoNow();
  const tx = db.transaction(() => {
    db.prepare("UPDATE users SET password_hash=?,force_password_change=0,password_changed_at=?,updated_at=?,row_version=row_version+1 WHERE id=?").run(passwordHash, now, now, userId);
    db.prepare("UPDATE api_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").run(now, userId);
  });
  tx();
  db.close();
}

export async function ensureInitialAdmin(): Promise<void> {
  const username = process.env.ADMIN_USERNAME?.trim().toLowerCase();
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!username || !password) return;
  const db = getDatabase();
  const existing = db.prepare("SELECT id FROM users WHERE username_normalized=?").get(username);
  db.close();
  if (existing) return;
  const passwordHash = await hashPassword(password);
  const retryDb = getDatabase();
  const now = isoNow();
  retryDb.prepare(`INSERT OR IGNORE INTO users
    (id,username,username_normalized,password_hash,display_name,role,status,force_password_change,password_changed_at,created_at,updated_at,row_version)
    VALUES (?,?,?,?,?,'ADMIN','ACTIVE',1,?,?,?,1)`).run(
    createId("user"), username, username, passwordHash, username, now, now, now,
  );
  retryDb.close();
}

export function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    forcePasswordChange: row.force_password_change === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    version: row.row_version,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
