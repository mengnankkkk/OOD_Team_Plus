import {
  createClient,
  type Client,
  type InStatement,
  type InValue,
  type ResultSet,
} from "@libsql/client";

import { metadataSchemaSql } from "@/server/semantic-layer/schema";

export type SemanticLayerDb = Client;
export type SemanticLayerExecutor = {
  execute(stmt: InStatement): Promise<ResultSet>;
};

export function createSemanticLayerDb(url = ":memory:") {
  return createClient({ url });
}

export async function initSemanticLayerDb(db: SemanticLayerDb) {
  await db.executeMultiple(metadataSchemaSql);
  await ensureColumn(db, "metadata_semantic_tables", "sync_status", "text not null default 'active'");
  await ensureColumn(db, "metadata_semantic_columns", "sync_status", "text not null default 'active'");
  await ensureColumn(db, "metadata_logical_foreign_keys", "sync_status", "text not null default 'active'");
}

async function ensureColumn(
  db: SemanticLayerDb,
  table: string,
  column: string,
  definition: string,
) {
  const columns = await db.execute(`pragma table_info(${table})`);
  if (columns.rows.some((row) => row.name === column)) {
    return;
  }
  await db.execute(`alter table ${table} add column ${column} ${definition}`);
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

export async function existsActive(
  db: SemanticLayerDb,
  table: string,
  id: string,
) {
  const result = await db.execute({
    sql: `select id from ${table} where id = ? and status = 'active' limit 1`,
    args: [id],
  });
  return result.rows.length > 0;
}

export async function requireActive(
  db: SemanticLayerDb,
  table: string,
  id: string,
) {
  if (!(await existsActive(db, table, id))) {
    throw new Error(`Missing active ${table} record: ${id}`);
  }
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
