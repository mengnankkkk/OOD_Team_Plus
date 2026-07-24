import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

export interface SqliteDb {
  close: () => void;
  exec: (sql: string) => void;
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

  return db as unknown as SqliteDb;
}
