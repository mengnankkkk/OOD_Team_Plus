import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { backupDatabase, prepareDatabase } from "./migration-runner";

describe("database migration guard", () => {
  it("executes and records every migration", () => {
    const db = new Database(":memory:");
    prepareDatabase(db as never, ":memory:");
    expect(db.pragma("user_version", { simple: true })).toBe(16);
    expect((db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count).toBe(18);
    expect(() => prepareDatabase(db as never, ":memory:")).not.toThrow();
    db.close();
  });

  it("migrates complete watchlist observation contracts", () => {
    const db = new Database(":memory:");
    prepareDatabase(db as never, ":memory:");

    const columnNames = (table: string) =>
      (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((column) => column.name);

    expect(db.pragma("user_version", { simple: true })).toBe(16);
    expect((db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count).toBe(18);
    expect(columnNames("watchlist_items")).toEqual(expect.arrayContaining(["goal_id", "source_type"]));
    expect(columnNames("observation_conditions")).toEqual(expect.arrayContaining([
      "watchlist_item_id",
      "severity",
      "threshold_date",
      "window_days",
      "config_json",
      "last_triggered_at",
    ]));
    expect((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rss_item_instruments'").get() as { name: string } | undefined)?.name)
      .toBe("rss_item_instruments");

    const conditionForeignKeys = db.prepare("PRAGMA foreign_key_list(observation_conditions)").all() as Array<{
      from: string;
      on_delete: string;
      table: string;
    }>;
    expect(conditionForeignKeys).toContainEqual(expect.objectContaining({
      from: "watchlist_item_id",
      on_delete: "SET NULL",
      table: "watchlist_items",
    }));

    const indexes = (table: string) =>
      (db.prepare(`PRAGMA index_list("${table}")`).all() as Array<{ name: string }>).map((index) => index.name);
    expect(indexes("observation_conditions")).toContain("idx_observation_conditions_watchlist_item");
    expect(indexes("rss_item_instruments")).toEqual(expect.arrayContaining([
      "idx_rss_item_instruments_unique",
      "idx_rss_item_instruments_instrument",
    ]));
    db.close();
  });

  it("does not duplicate legacy equivalent drawdown conditions during upgrade", () => {
    const db = new Database(":memory:");
    createLegacy0015WatchlistSchema(db);
    const now = "2026-07-25T00:00:00.000Z";

    db.prepare("INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)").run("legacy-user", "Legacy User", now);
    db.prepare("INSERT INTO watchlists (id, user_id, name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)")
      .run("wl_legacy", "legacy-user", "持仓观测", now, now);
    db.prepare(`INSERT INTO watchlist_items
      (id, watchlist_id, instrument_id, reason, planned_horizon, status, added_at, created_at, updated_at, drawdown_threshold_bps)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`)
      .run("wi_legacy", "wl_legacy", "AAPL", "already watched", "长期", now, now, now, 1500);
    db.prepare(`INSERT INTO observation_conditions
      (id, user_id, instrument_id, condition_type, threshold_decimal, status, created_at, updated_at)
      VALUES (?, ?, ?, 'DRAWDOWN_REACH', ?, 'active', ?, ?)`)
      .run("condition_existing", "legacy-user", "AAPL", "0.15", now, now);

    prepareDatabase(db as never, ":memory:");

    const rows = db.prepare(`SELECT id, watchlist_item_id, threshold_decimal, window_days
      FROM observation_conditions
      WHERE user_id = ? AND instrument_id = ? AND condition_type = 'DRAWDOWN_REACH' AND status = 'active'
      ORDER BY id`).all("legacy-user", "AAPL") as Array<{
      id: string;
      threshold_decimal: string;
      watchlist_item_id: string | null;
      window_days: number | null;
    }>;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "condition_existing",
      threshold_decimal: "0.15",
      watchlist_item_id: null,
      window_days: null,
    });
    db.close();
  });

  it("does not create backups for in-memory databases", () => {
    expect(backupDatabase(":memory:")).toBe(":memory:");
  });

  it("creates a consistent online backup that can restore stored values", () => {
    const directory = mkdtempSync(join(tmpdir(), "money-whisperer-backup-"));
    const sourcePath = join(directory, "source.db");
    const source = new Database(sourcePath);
    source.pragma("journal_mode = WAL");
    source.exec("CREATE TABLE ledger (id TEXT PRIMARY KEY, amount_decimal TEXT NOT NULL); INSERT INTO ledger VALUES ('asset-1','1234567890.123456789');");
    const target = backupDatabase(sourcePath, source as never);
    source.close();

    const restored = new Database(target, { readonly: true });
    const row = restored.prepare("SELECT amount_decimal FROM ledger WHERE id='asset-1'").get() as { amount_decimal: string };
    restored.close();
    expect(row.amount_decimal).toBe("1234567890.123456789");
    rmSync(directory, { recursive: true, force: true });
  });
});

function createLegacy0015WatchlistSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE goals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE instruments (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      market TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      sector TEXT,
      tradable INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE watchlists (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      row_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX idx_watchlists_user_name ON watchlists(user_id, name);
    CREATE TABLE watchlist_items (
      id TEXT PRIMARY KEY,
      watchlist_id TEXT NOT NULL,
      instrument_id TEXT NOT NULL,
      reason TEXT,
      planned_horizon TEXT,
      drawdown_threshold_bps INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      added_at TEXT NOT NULL,
      removed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE observation_conditions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      holding_id TEXT,
      instrument_id TEXT,
      condition_type TEXT NOT NULL,
      threshold_decimal TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      source_recommendation_id TEXT,
      last_observed_decimal TEXT,
      last_evaluated_at TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE rss_items (
      id TEXT PRIMARY KEY,
      feed_id TEXT NOT NULL,
      guid TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const migrationDirectory = join(process.cwd(), "src", "server", "db", "migrations");
  const migrations = readdirSync(migrationDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name) && name < "0016_")
    .sort((left, right) => left.localeCompare(right))
    .map((name) => {
      const sql = readFileSync(join(migrationDirectory, name), "utf8");
      return { name, version: Number(name.slice(0, 4)), sql, checksum: createHash("sha256").update(sql).digest("hex") };
    });

  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const record = db.prepare("INSERT INTO schema_migrations (name, version, checksum, applied_at) VALUES (?, ?, ?, ?)");
  for (const migration of migrations) record.run(migration.name, migration.version, migration.checksum, "2026-07-25T00:00:00.000Z");
  db.pragma("user_version = 15");
}
