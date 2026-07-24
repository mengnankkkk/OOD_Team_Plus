import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("better-sqlite3", () => ({ default: vi.fn() }));

import type { SqliteDb } from "../../db/client.runtime";

import { CHUNK_SIZE, persistQueryResult } from "./result-persister";

function createMockDb() {
  const run = vi.fn();
  const prepare = vi.fn().mockReturnValue({ run });
  const transaction = vi.fn((fn: () => void) => fn);

  return { prepare, run, transaction };
}

describe("persistQueryResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("splits rows into chunks of at most CHUNK_SIZE", () => {
    const database = createMockDb();
    const rows = Array.from({ length: 1001 }, (_, id) => ({ id }));

    const summary = persistQueryResult({
      queryId: "query1",
      result: {
        rows,
        columns: [{ name: "id", type: "INTEGER" }],
        rowCount: rows.length,
        isTruncated: false,
        resultSizeBytes: 1000,
      },
      getDb: () => database as unknown as SqliteDb,
      nowIso: "2026-07-24T00:00:00.000Z",
    });

    const insertCalls = database.run.mock.calls.slice(0, 3);
    expect(summary).toEqual({
      chunkCount: 3,
      totalRows: 1001,
      totalBytes: 1000,
      isTruncated: false,
    });
    expect(insertCalls.map(([id, , chunkNo, firstRowNo, rowCount]) => [
      id,
      chunkNo,
      firstRowNo,
      rowCount,
    ])).toEqual([
      ["chunk_query1_0", 0, 0, CHUNK_SIZE],
      ["chunk_query1_1", 1, CHUNK_SIZE, CHUNK_SIZE],
      ["chunk_query1_2", 2, CHUNK_SIZE * 2, 1],
    ]);
    expect(insertCalls.every(([, , , , rowCount]) => rowCount <= CHUNK_SIZE)).toBe(true);
  });

  it("computes SHA-256 and UTF-8 byte size for each chunk", () => {
    const database = createMockDb();
    const rows = [{ id: "一" }, { id: "2" }];
    const rowsJson = JSON.stringify(rows);

    persistQueryResult({
      queryId: "q1",
      result: { rows, columns: [], rowCount: 2, isTruncated: false, resultSizeBytes: 50 },
      getDb: () => database as unknown as SqliteDb,
      nowIso: "2026-07-24T00:00:00.000Z",
    });

    const [chunkInsert] = database.run.mock.calls;
    expect(chunkInsert[5]).toBe(rowsJson);
    expect(chunkInsert[6]).toBe(createHash("sha256").update(rowsJson).digest("hex"));
    expect(chunkInsert[7]).toBe(Buffer.byteLength(rowsJson, "utf8"));
  });

  it("updates the query as succeeded with result metadata", () => {
    const database = createMockDb();

    persistQueryResult({
      queryId: "q1",
      result: { rows: [{ id: "1" }], columns: [], rowCount: 1, isTruncated: true, resultSizeBytes: 20 },
      getDb: () => database as unknown as SqliteDb,
      nowIso: "2026-07-24T00:00:00.000Z",
    });

    const updateCall = database.run.mock.calls.at(-1) as unknown[];
    expect(updateCall).toEqual([
      1,
      20,
      1,
      "2026-07-24T00:00:00.000Z",
      expect.any(String),
      "2026-07-24T00:00:00.000Z",
      "q1",
    ]);
    expect(database.transaction).toHaveBeenCalledTimes(1);
  });

  it("does not return success when the transaction fails", () => {
    const database = createMockDb();
    database.transaction.mockImplementation(() => {
      throw new Error("transaction failed");
    });

    expect(() => persistQueryResult({
      queryId: "q1",
      result: { rows: [{ id: "1" }], columns: [], rowCount: 1, isTruncated: false, resultSizeBytes: 20 },
      getDb: () => database as unknown as SqliteDb,
    })).toThrow("transaction failed");
  });
});
