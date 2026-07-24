import { describe, expect, it, vi } from "vitest";

vi.mock("better-sqlite3", () => ({ default: vi.fn() }));

import type { SqliteDb } from "../../db/client.runtime";

import { executeQuery } from "./executor";

function createMockDb(rows: Record<string, unknown>[] = []) {
  return {
    authorizer: vi.fn(),
    prepare: vi.fn().mockReturnValue({
      all: () => rows,
      columns: () => [{ name: "id", type: null }],
    }),
  };
}

describe("executeQuery", () => {
  it("appends LIMIT and returns rows and columns", async () => {
    const database = createMockDb([{ id: "1" }]);

    const result = await executeQuery(
      "SELECT id FROM portfolio_snapshots WHERE user_id = 'u1'",
      100,
      () => database as unknown as SqliteDb,
    );

    expect(database.prepare).toHaveBeenCalledWith(expect.stringContaining("LIMIT 100"));
    expect(result).toMatchObject({
      columns: [{ name: "id", type: "TEXT" }],
      rowCount: 1,
      isTruncated: false,
    });
  });

  it("replaces an existing LIMIT with the clamped limit", async () => {
    const database = createMockDb();

    await executeQuery("SELECT id FROM portfolio_snapshots LIMIT 99999", 20_000, () =>
      database as unknown as SqliteDb,
    );

    expect(database.prepare).toHaveBeenCalledWith("SELECT id FROM portfolio_snapshots LIMIT 10000");
  });

  it("rejects invalid SQL before opening the database", async () => {
    const getDb = vi.fn();

    await expect(executeQuery("DROP TABLE users", 10, getDb)).rejects.toMatchObject({
      code: "SQL_SECURITY_VIOLATION",
    });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("applies the readonly authorizer before preparing SQL", async () => {
    const database = createMockDb();

    await executeQuery("SELECT id FROM portfolio_snapshots", 10, () =>
      database as unknown as SqliteDb,
    );

    expect(database.authorizer).toHaveBeenCalledWith(expect.any(Function));
    expect(database.authorizer.mock.invocationCallOrder[0]).toBeLessThan(
      database.prepare.mock.invocationCallOrder[0],
    );
  });

  it("truncates serialized rows to the 5 MiB cap", async () => {
    const database = createMockDb([
      { id: "1", value: "x".repeat(3 * 1024 * 1024) },
      { id: "2", value: "y".repeat(3 * 1024 * 1024) },
    ]);

    const result = await executeQuery("SELECT id FROM portfolio_snapshots", 10, () =>
      database as unknown as SqliteDb,
    );

    expect(result.rowCount).toBe(1);
    expect(result.isTruncated).toBe(true);
    expect(result.resultSizeBytes).toBeLessThanOrEqual(5 * 1024 * 1024);
  });
});
