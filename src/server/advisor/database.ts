import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { advisorSchema } from "@/server/advisor/schema";

export type AdvisorDatabase = DatabaseSync;

function databasePath() {
  if (process.env.NODE_ENV === "test" || process.env.NEXT_PHASE === "phase-production-build") return ":memory:";
  return process.env.ADVISOR_DATABASE_PATH?.trim() || path.join(process.cwd(), ".data", "money-whisperer.sqlite");
}

export function openAdvisorDatabase(filePath = databasePath()) {
  if (filePath !== ":memory:") mkdirSync(path.dirname(filePath), { recursive: true });
  const database = new DatabaseSync(filePath);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
  database.exec(advisorSchema[0]);
  const current = database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version?: number } | undefined;
  if (!current?.version) {
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of advisorSchema.slice(1)) database.exec(statement);
      database.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)").run(1, new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const latest = database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version?: number } | undefined;
  if (Number(latest?.version ?? 0) < 2) {
    database.exec(`CREATE TABLE IF NOT EXISTS watchlist_items (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, instrument_id TEXT NOT NULL, note TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(user_id, instrument_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE CASCADE
    )`);
    database.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(2, ?)").run(new Date().toISOString());
  }
  const afterWatchlist = database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version?: number } | undefined;
  if (Number(afterWatchlist?.version ?? 0) < 3) {
    const columns = database.prepare("PRAGMA table_info(conversation_sessions)").all() as Array<{ name?: string }>;
    if (!columns.some((column) => column.name === "context_json")) {
      database.exec("ALTER TABLE conversation_sessions ADD COLUMN context_json TEXT");
    }
    database.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(3, ?)").run(new Date().toISOString());
  }
  return database;
}

const globalDatabase = globalThis as typeof globalThis & { moneyWhispererAdvisorDatabase?: AdvisorDatabase };
export const advisorDatabase = globalDatabase.moneyWhispererAdvisorDatabase ?? openAdvisorDatabase();

if (process.env.NODE_ENV !== "production") globalDatabase.moneyWhispererAdvisorDatabase = advisorDatabase;
