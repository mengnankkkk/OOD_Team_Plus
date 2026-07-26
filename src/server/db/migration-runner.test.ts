import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { prepareDatabase } from "./migration-runner";

describe("database migration guard", () => {
  it("executes and records every migration", () => {
    const db = new Database(":memory:");
    prepareDatabase(db as never, ":memory:");
    expect(db.pragma("user_version", { simple: true })).toBe(17);
    expect((db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count).toBe(19);
    expect(() => prepareDatabase(db as never, ":memory:")).not.toThrow();
    db.close();
  });

  it("migrates complete watchlist observation contracts", () => {
    const db = new Database(":memory:");
    prepareDatabase(db as never, ":memory:");

    const columnNames = (table: string) =>
      (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((column) => column.name);

    expect(db.pragma("user_version", { simple: true })).toBe(17);
    expect((db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count).toBe(19);
    expect(columnNames("data_queries")).toContain("idempotency_key");
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
    expect(indexes("data_queries")).toContain("idx_data_queries_user_idempotency");
    db.close();
  });

  it("does not duplicate legacy equivalent drawdown conditions during upgrade", () => {
    const db = new Database(":memory:");
    createLegacy0015WatchlistSchema(db);
    const now = "2026-07-25T00:00:00.000Z";

    db.prepare("INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)").run("legacy-user", "Legacy User", now);
    db.prepare("INSERT INTO watchlists (id, user_id, name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)")
      .run("wl_legacy", "legacy-user", "持仓观测", now, now);
    db.prepare("INSERT INTO watchlists (id, user_id, name, status, created_at, updated_at) VALUES (?, ?, ?, 'archived', ?, ?)")
      .run("wl_archived", "legacy-user", "已归档观察", now, now);
    db.prepare("INSERT INTO watchlists (id, user_id, name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)")
      .run("wl_secondary", "legacy-user", "次要观察", now, now);
    db.prepare(`INSERT INTO watchlist_items
      (id, watchlist_id, instrument_id, reason, planned_horizon, status, added_at, created_at, updated_at, drawdown_threshold_bps)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`)
      .run("wi_legacy", "wl_legacy", "AAPL", "already watched", "长期", now, now, now, 1500);
    db.prepare(`INSERT INTO watchlist_items
      (id, watchlist_id, instrument_id, reason, planned_horizon, status, added_at, created_at, updated_at, drawdown_threshold_bps)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`)
      .run(
        "wi_duplicate",
        "wl_legacy",
        "AAPL",
        "duplicate",
        "长期",
        "2026-07-25T01:00:00.000Z",
        "2026-07-25T01:00:00.000Z",
        "2026-07-25T01:00:00.000Z",
        1500,
      );
    db.prepare(`INSERT INTO watchlist_items
      (id, watchlist_id, instrument_id, reason, planned_horizon, status, added_at, created_at, updated_at, drawdown_threshold_bps)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`)
      .run("wi_fresh", "wl_legacy", "MSFT", "needs backfill", "长期", now, now, now, 1200);
    db.prepare(`INSERT INTO watchlist_items
      (id, watchlist_id, instrument_id, reason, planned_horizon, status, added_at, created_at, updated_at, drawdown_threshold_bps)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`)
      .run("wi_secondary", "wl_secondary", "AAPL", "same symbol other list", "长期", now, now, now, 1500);
    db.prepare(`INSERT INTO watchlist_items
      (id, watchlist_id, instrument_id, reason, planned_horizon, status, added_at, created_at, updated_at, drawdown_threshold_bps)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`)
      .run("wi_paused", "wl_legacy", "SPY", "paused rule", "长期", now, now, now, 1000);
    db.prepare(`INSERT INTO watchlist_items
      (id, watchlist_id, instrument_id, reason, planned_horizon, status, added_at, created_at, updated_at, drawdown_threshold_bps)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`)
      .run("wi_archived", "wl_archived", "SPY", "archived list", "长期", now, now, now, 1000);
    db.prepare(`INSERT INTO watchlist_items
      (id, watchlist_id, instrument_id, reason, planned_horizon, status, added_at, removed_at, created_at, updated_at, drawdown_threshold_bps)
      VALUES (?, ?, ?, ?, ?, 'removed', ?, ?, ?, ?, ?)`)
      .run("wi_removed", "wl_legacy", "GLD", "removed item", "短期", now, now, now, now, 1100);
    db.prepare(`INSERT INTO observation_conditions
      (id, user_id, instrument_id, condition_type, threshold_decimal, status, created_at, updated_at)
      VALUES (?, ?, ?, 'DRAWDOWN_REACH', ?, 'active', ?, ?)`)
      .run("condition_existing", "legacy-user", "AAPL", "0.15", now, now);
    db.prepare(`INSERT INTO observation_conditions
      (id, user_id, instrument_id, condition_type, threshold_decimal, status, created_at, updated_at)
      VALUES (?, ?, ?, 'DRAWDOWN_REACH', ?, 'paused', ?, ?)`)
      .run("condition_paused", "legacy-user", "SPY", "0.10", now, now);
    db.prepare(`INSERT INTO observation_conditions
      (id, user_id, holding_id, instrument_id, condition_type, threshold_decimal, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'DRAWDOWN_REACH', ?, 'active', ?, ?)`)
      .run("condition_holding", "legacy-user", "holding-legacy", "MSFT", "0.12", now, now);

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

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: "condition_existing",
      threshold_decimal: "0.15",
      watchlist_item_id: "wi_legacy",
      window_days: 20,
    });
    expect(rows[1]).toMatchObject({
      threshold_decimal: "0.15",
      watchlist_item_id: "wi_secondary",
      window_days: 20,
    });

    const duplicate = db.prepare("SELECT status, removed_at, row_version FROM watchlist_items WHERE id = ?")
      .get("wi_duplicate") as { removed_at: string | null; row_version: number; status: string };
    expect(duplicate).toMatchObject({
      status: "removed",
      removed_at: "2026-07-25T01:00:00.000Z",
      row_version: 2,
    });
    expect((db.prepare(`SELECT COUNT(*) AS count FROM watchlist_items
      WHERE watchlist_id = ? AND instrument_id = ? AND status = 'active'`).get("wl_legacy", "AAPL") as { count: number }).count).toBe(1);
    expect(db.prepare(`SELECT reason, planned_horizon, drawdown_threshold_bps
      FROM watchlist_items WHERE id = ?`).get("wi_legacy")).toEqual({
      reason: "already watched",
      planned_horizon: "长期",
      drawdown_threshold_bps: 1500,
    });

    const freshConditions = db.prepare(`SELECT watchlist_item_id, threshold_decimal, window_days
      FROM observation_conditions
      WHERE watchlist_item_id = ? AND condition_type = 'DRAWDOWN_REACH' AND status = 'active'`)
      .all("wi_fresh") as Array<{ threshold_decimal: string; watchlist_item_id: string; window_days: number }>;
    expect(freshConditions).toEqual([{
      watchlist_item_id: "wi_fresh",
      threshold_decimal: "0.12",
      window_days: 20,
    }]);
    expect(db.prepare(`SELECT watchlist_item_id,status,window_days FROM observation_conditions
      WHERE id='condition_paused'`).get()).toEqual({
      watchlist_item_id: "wi_paused",
      status: "paused",
      window_days: 20,
    });
    expect(db.prepare(`SELECT holding_id,watchlist_item_id FROM observation_conditions
      WHERE id='condition_holding'`).get()).toEqual({
      holding_id: "holding-legacy",
      watchlist_item_id: null,
    });
    expect((db.prepare(`SELECT COUNT(*) AS count FROM observation_conditions
      WHERE watchlist_item_id = ?`).get("wi_archived") as { count: number }).count).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) AS count FROM observation_conditions
      WHERE instrument_id = ? AND condition_type = 'DRAWDOWN_REACH'`).get("GLD") as { count: number }).count).toBe(0);

    expect(() => db.prepare(`INSERT INTO watchlist_items
      (id, watchlist_id, instrument_id, status, added_at, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?)`).run("wi_conflict", "wl_legacy", "AAPL", now, now, now))
      .toThrow(/UNIQUE constraint failed/u);

    expect(() => db.prepare(`INSERT INTO watchlists
      (id, user_id, name, status, created_at, updated_at)
      VALUES (?, ?, ?, 'deleted', ?, ?)`).run("wl_deleted_name_reuse", "legacy-user", "持仓观测", now, now))
      .not.toThrow();
    expect(() => db.prepare(`INSERT INTO watchlists
      (id, user_id, name, status, created_at, updated_at)
      VALUES (?, ?, ?, 'archived', ?, ?)`).run("wl_active_name_conflict", "legacy-user", "持仓观测", now, now))
      .toThrow(/UNIQUE constraint failed/u);
    db.close();
  });

});

function createLegacy0015WatchlistSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE goals (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE instruments (
      id TEXT PRIMARY KEY, symbol TEXT NOT NULL, name TEXT NOT NULL, market TEXT NOT NULL,
      asset_type TEXT NOT NULL, sector TEXT, tradable INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE watchlists (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT,
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      deleted_at TEXT, row_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX idx_watchlists_user_name ON watchlists(user_id, name);
    CREATE TABLE watchlist_items (
      id TEXT PRIMARY KEY, watchlist_id TEXT NOT NULL, instrument_id TEXT NOT NULL, reason TEXT,
      planned_horizon TEXT, drawdown_threshold_bps INTEGER, status TEXT NOT NULL DEFAULT 'active',
      added_at TEXT NOT NULL, removed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      row_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE observation_conditions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, holding_id TEXT, instrument_id TEXT,
      condition_type TEXT NOT NULL, threshold_decimal TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      source_recommendation_id TEXT, last_observed_decimal TEXT, last_evaluated_at TEXT,
      version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE data_queries (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, agent_run_id TEXT NOT NULL,
      status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE rss_items (id TEXT PRIMARY KEY, feed_id TEXT NOT NULL, guid TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL);
  `);

  const migrations = readdirSync(join(process.cwd(), "src", "server", "db", "migrations"))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name) && name < "0016_")
    .sort((left, right) => left.localeCompare(right))
    .map((name) => {
      const sql = readFileSync(join(process.cwd(), "src", "server", "db", "migrations", name), "utf8");
      return { name, version: Number(name.slice(0, 4)), sql, checksum: createHash("sha256").update(sql).digest("hex") };
    });

  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, version INTEGER NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL
  )`);
  const record = db.prepare("INSERT INTO schema_migrations (name, version, checksum, applied_at) VALUES (?, ?, ?, ?)");
  for (const migration of migrations) record.run(migration.name, migration.version, migration.checksum, "2026-07-25T00:00:00.000Z");
  db.pragma("user_version = 15");
}
