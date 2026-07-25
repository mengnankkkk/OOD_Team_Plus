import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
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
