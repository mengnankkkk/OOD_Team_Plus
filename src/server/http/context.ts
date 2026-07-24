import type { NextRequest } from "next/server";

import { getDbClient } from "@/server/db/client";

export const DEMO_USER_ID = "demo-user";

export function getRequestContext(request?: NextRequest): { userId: string; sessionId: string | null } {
  const sessionId = request?.cookies.get("mw_demo_session")?.value ?? null;
  return { userId: DEMO_USER_ID, sessionId };
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
  return request.headers.get("Idempotency-Key");
}
