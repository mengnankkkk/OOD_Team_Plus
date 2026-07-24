import type { SqliteDb } from "../../db/client.runtime";
import { createExtensionError, ExtensionErrorCode } from "../errors/codes";
import { ALLOWED_TABLES, validateSql } from "../security/sql-ast-parser";
import { applyReadOnlyAuthorizer } from "../security/sqlite-authorizer";

const MAX_ROWS = 10_000;
const DEFAULT_ROWS = 2_000;
const MAX_RESULT_BYTES = 5 * 1024 * 1024;
const QUERY_TIMEOUT_MS = 30_000;

interface QueryStatement {
  all(...parameters: unknown[]): unknown[];
  columns(): Array<{ name: string; type: string | null }>;
}

interface QueryDatabase {
  authorizer?: Parameters<typeof applyReadOnlyAuthorizer>[0]["authorizer"];
  pragma?: Parameters<typeof applyReadOnlyAuthorizer>[0]["pragma"];
  prepare(sql: string): QueryStatement;
}

export interface QueryExecutionResult {
  rows: Record<string, unknown>[];
  columns: Array<{ name: string; type: string }>;
  rowCount: number;
  isTruncated: boolean;
  resultSizeBytes: number;
}

export async function executeQuery(
  sql: string,
  limit = DEFAULT_ROWS,
  getDb: () => SqliteDb = () => {
    throw new Error("No DB factory provided");
  },
  parameters: readonly unknown[] = [],
): Promise<QueryExecutionResult> {
  if (!validateSql(sql, ALLOWED_TABLES).valid) {
    throw createExtensionError(
      ExtensionErrorCode.SQL_SECURITY_VIOLATION,
      "SQL validation failed",
    );
  }

  const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), MAX_ROWS);
  const database = getDb() as unknown as QueryDatabase;
  const releaseReadOnlyGuard = applyReadOnlyAuthorizer(database);

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () =>
        reject(
          createExtensionError(
            ExtensionErrorCode.QUERY_TIMEOUT,
            "Query timed out",
            undefined,
            true,
          ),
        ),
      QUERY_TIMEOUT_MS,
    );
  });

  const query = Promise.resolve().then(() => {
    const statement = database.prepare(ensureLimit(sql, safeLimit));
    return {
      columns: statement.columns().map(({ name, type }) => ({ name, type: type ?? "TEXT" })),
      rows: statement.all(...parameters) as Record<string, unknown>[],
    };
  });
  try {
    const { columns, rows } = await Promise.race([query, timeout]);
    const serializedSize = Buffer.byteLength(JSON.stringify(rows), "utf8");
    const finalRows = serializedSize > MAX_RESULT_BYTES ? truncateRows(rows) : rows;

    return {
      rows: finalRows,
      columns,
      rowCount: finalRows.length,
      isTruncated: finalRows.length < rows.length,
      resultSizeBytes: Buffer.byteLength(JSON.stringify(finalRows), "utf8"),
    };
  } finally {
    releaseReadOnlyGuard();
  }
}

function ensureLimit(sql: string, limit: number): string {
  const withoutTerminator = sql.trim().replace(/;$/u, "");
  return /\bLIMIT\s+\d+/iu.test(withoutTerminator)
    ? withoutTerminator.replace(/\bLIMIT\s+\d+/iu, `LIMIT ${limit}`)
    : `${withoutTerminator} LIMIT ${limit}`;
}

function truncateRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  let size = 2;
  let count = 0;

  for (const row of rows) {
    const rowSize = Buffer.byteLength(JSON.stringify(row), "utf8") + (count ? 1 : 0);
    if (size + rowSize > MAX_RESULT_BYTES) break;
    size += rowSize;
    count += 1;
  }

  return rows.slice(0, count);
}
