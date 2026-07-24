import { ALLOWED_FUNCTIONS } from "./sql-ast-parser";

const SQLITE_SELECT = 21;
const SQLITE_READ = 20;
const SQLITE_FUNCTION = 31;
const SQLITE_OK = 0;
const SQLITE_DENY = 1;

const ALLOWED_READ_TABLES = new Set([
  "portfolio_snapshots",
  "holding_snapshots",
  "market_snapshots",
  "market_snapshot_metrics",
  "portfolio_score_snapshots",
  "instruments",
  "data_queries",
  "data_query_result_chunks",
]);

type AuthorizerCallback = (
  action: number,
  arg1: string | null,
  arg2: string | null,
  databaseName: string | null,
  triggerName: string | null,
) => number;

interface AuthorizableDatabase {
  authorizer?: (callback: AuthorizerCallback) => unknown;
  pragma?: (sql: string) => unknown;
}

/** Installs a deny-by-default policy before statements are prepared by SQLite. */
export function applyReadOnlyAuthorizer(
  database: AuthorizableDatabase,
  allowedTables: ReadonlySet<string> = ALLOWED_READ_TABLES,
): () => void {
  if (!database.authorizer) {
    if (!database.pragma) throw new Error("SQLite read-only guard is unavailable");
    database.pragma("query_only = ON");
    return () => { database.pragma?.("query_only = OFF"); };
  }
  database.authorizer((action, arg1, arg2) => {
    if (action === SQLITE_SELECT) return SQLITE_OK;

    if (action === SQLITE_READ) {
      const table = arg1?.toLowerCase();
      return table && allowedTables.has(table) ? SQLITE_OK : SQLITE_DENY;
    }

    if (action === SQLITE_FUNCTION) {
      const functionName = arg2?.toLowerCase();
      return functionName && ALLOWED_FUNCTIONS.has(functionName) ? SQLITE_OK : SQLITE_DENY;
    }

    return SQLITE_DENY;
  });
  return () => undefined;
}

export { ALLOWED_READ_TABLES };
