import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { ensureRuntimeSchema } from "./runtime-schema";
import { prepareDatabase } from "./migration-runner";

export interface SqliteDb {
  close: () => void;
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    get: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
    run: (...params: unknown[]) => { changes: number; lastInsertRowid?: number | bigint };
    columns?: () => Array<{ name: string; type?: string | null }>;
  };
  transaction: (fn: () => void) => () => void;
  pragma: (sql: string, options?: { simple?: boolean }) => unknown;
}

export function getDbClient(): SqliteDb {
  const dbPath = path.resolve(process.cwd(), process.env.DB_PATH ?? "./data/mw-dev.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const database = new Database(dbPath);

  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.pragma("synchronous = NORMAL");
  database.pragma("busy_timeout = 5000");

  if (typeof (database as unknown as Partial<SqliteDb>).prepare === "function") {
    const db = wrapWithBusyRetry(database);
    ensureRuntimeSchema(db);
    prepareDatabase(db, dbPath);
    return db;
  }

  return database as unknown as SqliteDb;
}

function wrapWithBusyRetry(database: Database.Database): SqliteDb {
  return {
    close: () => database.close(),
    exec: (sql) => { withBusyRetry(() => database.exec(sql)); },
    pragma: (sql, options) => database.pragma(sql, options),
    prepare: (sql) => {
      const statement = database.prepare(sql);
      return {
        get: (...params) => statement.get(...params),
        all: (...params) => statement.all(...params) as unknown[],
        run: (...params) => withBusyRetry(() => statement.run(...params)),
        columns: () => statement.columns().map((column) => ({ name: column.name, type: column.type })),
      };
    },
    transaction: (fn) => {
      const transaction = database.transaction(fn);
      return () => { withBusyRetry(() => transaction()); };
    },
  };
}

export function withBusyRetry<T>(operation: () => T): T {
  const delays = [25, 75, 225];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (!isBusy(error) || attempt >= delays.length) throw error;
      synchronousDelay(delays[attempt]);
    }
  }
}

function isBusy(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "SQLITE_BUSY" || /SQLITE_BUSY|database is locked/iu.test(message);
}

function synchronousDelay(milliseconds: number): void {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}
