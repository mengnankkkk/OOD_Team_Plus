import type { SqliteDb } from "@/server/db/client.runtime";

export type InValue = string | number | bigint | boolean | null | Uint8Array;
export type SemanticRow = Record<string, unknown>;
export type SemanticStatement = { sql: string; args?: InValue[] };

export type SemanticResultSet = {
  rows: SemanticRow[];
  rowsAffected: number;
  lastInsertRowid?: number | bigint;
};

export type SemanticLayerExecutor = {
  execute(statement: string | SemanticStatement): Promise<SemanticResultSet>;
};

export type SemanticLayerTransaction = SemanticLayerExecutor & {
  closed: boolean;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): void;
};

export class SemanticLayerDb implements SemanticLayerExecutor {
  constructor(private readonly database: SqliteDb) {}

  async execute(statement: string | SemanticStatement): Promise<SemanticResultSet> {
    const { sql, args } = normalizeStatement(statement);
    const prepared = this.database.prepare(sql);
    if (/^\s*(?:SELECT|PRAGMA|WITH\b[^;]*\bSELECT)\b/iu.test(sql)) {
      return { rows: prepared.all(...args) as SemanticRow[], rowsAffected: 0 };
    }
    const result = prepared.run(...args) as { changes: number; lastInsertRowid?: number | bigint };
    return { rows: [], rowsAffected: result.changes, lastInsertRowid: result.lastInsertRowid };
  }

  async batch(statements: SemanticStatement[], _mode?: "read" | "write"): Promise<SemanticResultSet[]> {
    const results: SemanticResultSet[] = [];
    const transaction = this.database.transaction(() => {
      for (const statement of statements) results.push(executeSync(this.database, statement));
    });
    transaction();
    return results;
  }

  async transaction(_mode?: "read" | "write"): Promise<SemanticLayerTransaction> {
    this.database.exec("BEGIN IMMEDIATE");
    let closed = false;
    const execute = async (statement: string | SemanticStatement) => {
      if (closed) throw new Error("Semantic layer transaction is closed");
      return executeSync(this.database, statement);
    };
    return {
      get closed() { return closed; },
      execute,
      commit: async () => {
        if (!closed) this.database.exec("COMMIT");
        closed = true;
      },
      rollback: async () => {
        if (!closed) this.database.exec("ROLLBACK");
        closed = true;
      },
      close: () => {
        if (!closed) this.database.exec("ROLLBACK");
        closed = true;
      },
    };
  }

  close(): void {
    this.database.close();
  }
}

export function createSemanticLayerDb(database: SqliteDb): SemanticLayerDb {
  return new SemanticLayerDb(database);
}

export async function initSemanticLayerDb(_db: SemanticLayerDb): Promise<void> {
  // Schema creation is migration-owned. This hook remains for service initialization.
}

export function nowIso() {
  return new Date().toISOString();
}

export function boolValue(value: boolean) {
  return value ? 1 : 0;
}

export function jsonValue(value: string[] | undefined) {
  return value ? JSON.stringify(value) : null;
}

export function nullable(value: string | undefined) {
  return value && value.length > 0 ? value : null;
}

export async function existsActive(db: SemanticLayerDb, table: string, id: string) {
  const result = await db.execute({
    sql: `select id from ${table} where id = ? and status = 'active' limit 1`,
    args: [id],
  });
  return result.rows.length > 0;
}

export async function requireActive(db: SemanticLayerDb, table: string, id: string) {
  if (!(await existsActive(db, table, id))) throw new Error(`Missing active ${table} record: ${id}`);
}

export function buildSet(updates: Record<string, InValue | undefined>) {
  const entries = Object.entries(updates).filter((entry) => entry[1] !== undefined);
  return {
    clause: entries.map(([key]) => `${key} = ?`).join(", "),
    args: entries.map(([, value]) => value) as InValue[],
  };
}

export function idsPlaceholders(ids: string[]) {
  return ids.map(() => "?").join(", ");
}

function executeSync(database: SqliteDb, statement: string | SemanticStatement): SemanticResultSet {
  const { sql, args } = normalizeStatement(statement);
  const prepared = database.prepare(sql);
  if (/^\s*(?:SELECT|PRAGMA|WITH\b[^;]*\bSELECT)\b/iu.test(sql)) {
    return { rows: prepared.all(...args) as SemanticRow[], rowsAffected: 0 };
  }
  const result = prepared.run(...args) as { changes: number; lastInsertRowid?: number | bigint };
  return { rows: [], rowsAffected: result.changes, lastInsertRowid: result.lastInsertRowid };
}

function normalizeStatement(statement: string | SemanticStatement): { sql: string; args: unknown[] } {
  const sql = typeof statement === "string" ? statement : statement.sql;
  const input = typeof statement === "string" ? [] : statement.args ?? [];
  return { sql, args: input.map((value) => typeof value === "boolean" ? (value ? 1 : 0) : value) };
}
