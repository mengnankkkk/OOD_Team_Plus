import type { NextRequest } from "next/server";
import { createHash } from "node:crypto";

import { getDbClient } from "@/server/db/client";

export const DEMO_USER_ID = "demo-user";

export function getRequestContext(request?: NextRequest): { userId: string; sessionId: string | null } {
  const token = request?.cookies.get("mw_session")?.value;
  if (token) {
    const db = getDatabase();
    const row = db.prepare("SELECT id,user_id FROM api_sessions WHERE token_hash=? AND expires_at>? LIMIT 1").get(hashSessionToken(token), isoNow()) as { id?: string; user_id?: string } | undefined;
    if (row?.id && row.user_id) db.prepare("UPDATE api_sessions SET last_seen_at=? WHERE id=?").run(isoNow(), row.id);
    db.close();
    if (row?.id && row.user_id) return { userId: row.user_id, sessionId: row.id };
  }
  const legacySessionId = request?.cookies.get("mw_demo_session")?.value ?? null;
  return { userId: DEMO_USER_ID, sessionId: legacySessionId };
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
