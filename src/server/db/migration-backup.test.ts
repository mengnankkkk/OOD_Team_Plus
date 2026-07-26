import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { backupDatabase } from "./migration-runner";

describe("database migration backups", () => {
  it("does not create backups for in-memory databases", () => {
    expect(backupDatabase(":memory:")).toBe(":memory:");
  });

  it("creates a consistent online backup that can restore stored values", () => {
    const directory = mkdtempSync(join(tmpdir(), "money-whisperer-backup-"));
    const sourcePath = join(directory, "source.db");
    const source = new Database(sourcePath);
    source.pragma("journal_mode = WAL");
    source.exec(`CREATE TABLE ledger (
      id TEXT PRIMARY KEY,
      amount_decimal TEXT NOT NULL
    );
    INSERT INTO ledger VALUES ('asset-1','1234567890.123456789');`);
    const target = backupDatabase(sourcePath, source as never);
    source.close();

    const restored = new Database(target, { readonly: true });
    const row = restored.prepare("SELECT amount_decimal FROM ledger WHERE id='asset-1'")
      .get() as { amount_decimal: string };
    restored.close();
    expect(row.amount_decimal).toBe("1234567890.123456789");
    rmSync(directory, { recursive: true, force: true });
  });
});
