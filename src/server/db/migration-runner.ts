import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { SqliteDb } from "./client.runtime";

type Migration = { name: string; version: number; sql: string; checksum: string };

export function prepareDatabase(db: SqliteDb, dbPath: string): void {
  const migrations = loadMigrations();
  const targetVersion = Math.max(0, ...migrations.map((migration) => migration.version));
  const current = Number(db.pragma("user_version", { simple: true }) ?? 0);
  if (current > targetVersion) throw new Error(`Database version ${current} is newer than application version ${targetVersion}`);

  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Map((db.prepare("SELECT name, checksum FROM schema_migrations").all() as Array<{ name: string; checksum: string }>).map((row) => [row.name, row.checksum]));
  for (const migration of migrations) {
    const priorChecksum = applied.get(migration.name);
    if (priorChecksum && priorChecksum !== migration.checksum) throw new Error(`Applied migration ${migration.name} was modified`);
  }
  const pending = migrations.filter((migration) => !applied.has(migration.name));
  if (pending.length > 0 && dbPath !== ":memory:") backupDatabase(dbPath, db);

  for (const migration of pending) applyMigration(db, migration);
  db.pragma(`user_version = ${targetVersion}`);
}

function loadMigrations(): Migration[] {
  const candidates = [
    path.join(process.cwd(), "src", "server", "db", "migrations"),
    path.join(process.cwd(), "migrations"),
  ];
  const directory = candidates.find((candidate) => fs.existsSync(candidate));
  if (!directory) throw new Error("Database migrations directory was not found");
  return fs.readdirSync(directory)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => {
      const sql = fs.readFileSync(path.join(directory, name), "utf8");
      return { name, version: Number(name.slice(0, 4)), sql, checksum: createHash("sha256").update(sql).digest("hex") };
    });
}

function applyMigration(db: SqliteDb, migration: Migration): void {
  db.exec("BEGIN IMMEDIATE");
  let activeStatement = "";
  try {
    for (const statement of splitSqlStatements(migration.sql)) {
      activeStatement = statement;
      executeIdempotently(db, statement);
    }
    db.prepare("INSERT INTO schema_migrations (name, version, checksum, applied_at) VALUES (?, ?, ?, ?)")
      .run(migration.name, migration.version, migration.checksum, new Date().toISOString());
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* SQLite may already have rolled back. */ }
    const message = error instanceof Error ? error.message : String(error);
    const statementSummary = activeStatement.replace(/\s+/gu, " ").slice(0, 180);
    throw new Error(`Migration ${migration.name} failed at \"${statementSummary}\": ${message}`);
  }
}

function executeIdempotently(db: SqliteDb, rawStatement: string): void {
  const statement = rawStatement.trim();
  if (!statement) return;
  const alter = /^ALTER\s+TABLE\s+([\w"]+)\s+ADD\s+COLUMN\s+([\w"]+)/iu.exec(statement);
  if (alter) {
    const table = alter[1].replaceAll('"', "");
    const column = alter[2].replaceAll('"', "");
    const columns = db.prepare(`PRAGMA table_info("${table.replaceAll('"', '""')}")`).all() as Array<{ name: string }>;
    if (columns.some((item) => item.name.toLowerCase() === column.toLowerCase())) return;
  }
  const safeStatement = statement
    .replace(/^CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/iu, "CREATE TABLE IF NOT EXISTS ")
    .replace(/^CREATE\s+UNIQUE\s+INDEX\s+(?!IF\s+NOT\s+EXISTS)/iu, "CREATE UNIQUE INDEX IF NOT EXISTS ")
    .replace(/^CREATE\s+INDEX\s+(?!IF\s+NOT\s+EXISTS)/iu, "CREATE INDEX IF NOT EXISTS ");
  db.exec(safeStatement);
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: "'" | '"' | "`" | null = null;
  let lineComment = false;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];
    if (lineComment) {
      if (character === "\n") { lineComment = false; current += character; }
      continue;
    }
    if (!quote && character === "-" && next === "-") { lineComment = true; index += 1; continue; }
    if (quote) {
      current += character;
      if (character === quote) {
        if (next === quote) { current += next; index += 1; }
        else quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") { quote = character; current += character; continue; }
    if (character === ";") { if (current.trim()) statements.push(current.trim()); current = ""; continue; }
    current += character;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

export function backupDatabase(dbPath: string, db?: SqliteDb): string {
  if (dbPath === ":memory:") return dbPath;
  const absolute = path.resolve(dbPath);
  if (!fs.existsSync(absolute)) return absolute;
  const backupDir = path.join(path.dirname(absolute), "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const target = path.join(backupDir, `${path.basename(absolute)}.${new Date().toISOString().replaceAll(/[:.]/g, "-")}.bak`);
  if (!db) throw new Error("A live SQLite connection is required for an online backup");
  db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  return target;
}
