import type { NextRequest } from "next/server";
import { createHash } from "node:crypto";

import { getDbClient } from "@/server/db/client";
import { AuthFailure, type AuthUser } from "@/server/auth/contracts";

type SessionRow = {
  session_id: string;
  id: string;
  username: string;
  display_name: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "DISABLED";
  force_password_change: number;
  created_at: string;
  updated_at: string | null;
  row_version: number;
};

// Only test fixtures may use the historical user id; production requires a real session.
export const DEMO_USER_ID = "demo-user";

export function getRequestContext(request?: NextRequest): { userId: string; sessionId: string; user: AuthUser } {
  const token = request?.cookies.get("mw_session")?.value;
  if (token) {
    const db = getDatabase();
    const row = db.prepare(`SELECT s.id AS session_id,u.* FROM api_sessions s
      JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND s.revoked_at IS NULL
        AND u.status='ACTIVE' AND u.deleted_at IS NULL LIMIT 1`).get(hashSessionToken(token), isoNow()) as SessionRow | undefined;
    if (row?.session_id) db.prepare("UPDATE api_sessions SET last_seen_at=? WHERE id=?").run(isoNow(), row.session_id);
    db.close();
    if (row?.session_id) return { userId: row.id, sessionId: row.session_id, user: mapAuthUser(row) };
  }
  if (!token && process.env.NODE_ENV === "test") {
    const db = getDatabase();
    const row = db.prepare("SELECT * FROM users WHERE id=? AND status='ACTIVE'").get(DEMO_USER_ID) as SessionRow | undefined;
    db.close();
    if (row) return { userId: row.id, sessionId: "test-session", user: mapAuthUser(row) };
  }
  throw new AuthFailure("UNAUTHENTICATED", 401, "Authentication is required");
}

function mapAuthUser(row: SessionRow): AuthUser {
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

export function getDatabase() {
  return getDbClient() as unknown as {
    close: () => void;
    pragma: (sql: string, options?: { simple?: boolean }) => unknown;
    prepare: (sql: string) => { get: (...params: unknown[]) => unknown; all: (...params: unknown[]) => unknown[]; run: (...params: unknown[]) => { changes: number } };
    exec: (sql: string) => void;
    transaction: (fn: () => void) => () => void;
  };
}

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function json(value: unknown): string {
  return JSON.stringify(value);
}

export function pageParams(request: NextRequest): { limit: number; cursor: string | null } {
  const raw = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "20", 10);
  return { limit: Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 100) : 20, cursor: request.nextUrl.searchParams.get("cursor") };
}

export function meta(extra: Record<string, unknown> = {}) {
  return { requestId: createId("req"), apiVersion: "v1" as const, generatedAt: isoNow(), ...extra };
}

export function idempotencyKey(request: NextRequest): string | null {
  const value = request.headers.get("Idempotency-Key")?.trim() ?? "";
  return value.length > 0 && value.length <= 128 ? value : null;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
