import { createHash } from "node:crypto";

import type { SqliteDb } from "../../db/client.runtime";

import type { QueryExecutionResult } from "./executor";

const CHUNK_SIZE = 500;

interface PersistDb extends SqliteDb {
  prepare: (sql: string) => {
    run: (...args: unknown[]) => void;
  };
  transaction: (fn: () => void) => () => void;
}

export interface PersistQueryResultOptions {
  queryId: string;
  result: QueryExecutionResult;
  getDb: () => SqliteDb;
  nowIso?: string;
}

export interface PersistQueryResultSummary {
  chunkCount: number;
  totalRows: number;
  totalBytes: number;
  isTruncated: boolean;
}

/** Persist every result chunk and the succeeded query state in one transaction. */
export function persistQueryResult(
  options: PersistQueryResultOptions,
): PersistQueryResultSummary {
  const { queryId, result, getDb, nowIso = new Date().toISOString() } = options;
  const db = getDb() as PersistDb;
  const chunks = chunkArray(result.rows, CHUNK_SIZE);

  const transaction = db.transaction(() => {
    let firstRowNo = 0;

    for (let chunkNo = 0; chunkNo < chunks.length; chunkNo += 1) {
      const chunkRows = chunks[chunkNo];
      const rowsJson = JSON.stringify(chunkRows);
      const contentSha256 = createHash("sha256").update(rowsJson).digest("hex");
      const sizeBytes = Buffer.byteLength(rowsJson, "utf8");

      db.prepare(`
        INSERT INTO data_query_result_chunks
          (id, query_id, chunk_no, first_row_no, row_count, rows_json, content_sha256, size_bytes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `chunk_${queryId}_${chunkNo}`,
        queryId,
        chunkNo,
        firstRowNo,
        chunkRows.length,
        rowsJson,
        contentSha256,
        sizeBytes,
        nowIso,
      );

      firstRowNo += chunkRows.length;
    }

    db.prepare(`
      UPDATE data_queries SET
        status = 'succeeded',
        row_count = ?,
        result_size_bytes = ?,
        is_truncated = ?,
        completed_at = ?,
        result_expires_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      result.rowCount,
      result.resultSizeBytes,
      result.isTruncated ? 1 : 0,
      nowIso,
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      nowIso,
      queryId,
    );
  });

  transaction();

  return {
    chunkCount: chunks.length,
    totalRows: result.rowCount,
    totalBytes: result.resultSizeBytes,
    isTruncated: result.isTruncated,
  };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }

  return chunks;
}

export { CHUNK_SIZE };
