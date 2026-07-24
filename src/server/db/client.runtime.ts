import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { ensureRuntimeSchema } from "./runtime-schema";

export interface SqliteDb {
  close: () => void;
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    get: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
    run: (...params: unknown[]) => { changes: number };
    columns?: () => Array<{ name: string; type?: string | null }>;
  };
  transaction: (fn: () => void) => () => void;
  pragma: (sql: string, options?: { simple?: boolean }) => unknown;
}

export function getDbClient(): SqliteDb {
  const dbPath = path.resolve(process.cwd(), process.env.DB_PATH ?? "./data/mw-dev.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");

  if (typeof (db as unknown as Partial<SqliteDb>).prepare === "function") {
    ensureRuntimeSchema(db as unknown as SqliteDb);
  }

  return db as unknown as SqliteDb;
}
