import type { AdvisorDatabase } from "@/server/advisor/database";
import type { SQLInputValue } from "node:sqlite";

export type DbRow = Record<string, unknown>;

export function nowIso() {
  return new Date().toISOString();
}

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function json<T>(value: T) {
  return JSON.stringify(value);
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function runValue<T extends DbRow>(database: AdvisorDatabase, sql: string, ...params: unknown[]) {
  return database.prepare(sql).get(...(params as SQLInputValue[])) as T | undefined;
}

export function runRows<T extends DbRow>(database: AdvisorDatabase, sql: string, ...params: unknown[]) {
  return database.prepare(sql).all(...(params as SQLInputValue[])) as T[];
}

export function runWrite(database: AdvisorDatabase, sql: string, ...params: unknown[]) {
  return database.prepare(sql).run(...(params as SQLInputValue[]));
}

export function transaction(database: AdvisorDatabase, action: () => void) {
  database.exec("BEGIN IMMEDIATE");
  try {
    action();
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
