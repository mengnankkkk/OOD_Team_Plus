import { getDatabase } from "@/server/http/context";
import type { z } from "zod";
import type {
  createDatasourceSchema,
  PageQuery,
  updateDatasourceSchema,
} from "@/server/semantic-layer/contract";
import {
  boolValue,
  buildSet,
  idsPlaceholders,
  nullable,
  nowIso,
  type SemanticLayerExecutor,
  type SemanticLayerDb,
} from "@/server/semantic-layer/database";
import {
  datasourceSortMapper,
  likeKeyword,
  orderBy,
  pageArgs,
  pageResult,
} from "@/server/semantic-layer/pagination";
import { countFrom, datasourceFrom } from "@/server/semantic-layer/types";
import type { SyncTableInput } from "@/types/app/semantic";

export type DiscoveredSemanticDatasource = {
  key: string;
  label: string;
  description: string;
  schemaName: string;
  tables: SyncTableInput[];
};

export type SemanticDatasource = ReturnType<typeof datasourceFrom> & {
  key: string;
  label: string;
  tables: SyncTableInput[];
};

type CreateDatasource = z.infer<typeof createDatasourceSchema>;
type UpdateDatasource = z.infer<typeof updateDatasourceSchema>;
type TableRow = { name: string; type: string };
type ColumnRow = { name: string; type: string; not_null: number; dflt_value: string | null; pk: number; cid: number };

const INTERNAL_TABLES = new Set(["__drizzle_migrations", "migration_history", "idempotency_keys"]);

export function discoverSemanticDatasources(): { items: DiscoveredSemanticDatasource[] } {
  const db = getDatabase();
  try {
    const tableRows = db.prepare("SELECT name,type FROM pragma_table_list WHERE schema='main' ORDER BY name").all() as TableRow[];
    const tables = tableRows
      .filter((row) => row.type === "table" && !row.name.startsWith("sqlite_") && !INTERNAL_TABLES.has(row.name))
      .map((row): SyncTableInput => {
        const escapedName = row.name.replaceAll("'", "''");
        const columns = db.prepare(`SELECT cid,name,type,"notnull" AS not_null,dflt_value,pk FROM pragma_table_info('${escapedName}') ORDER BY cid`).all() as ColumnRow[];
        return {
          physicalTableName: row.name,
          physicalDescription: null,
          semanticName: null,
          semanticDescription: null,
          isVisible: true,
          columns: columns.map((column) => ({
            physicalColumnName: column.name,
            ordinalPosition: column.cid + 1,
            dataType: column.type || "text",
            isNullable: column.not_null === 0,
            isPrimaryKey: column.pk > 0,
            defaultValue: column.dflt_value,
            physicalDescription: null,
            semanticName: null,
            semanticDescription: null,
            businessType: null,
            exampleValues: [],
            isVisible: true,
          })),
        };
      });
    return { items: [{ key: "local-sqlite", label: "Money Whisperer SQLite", description: "当前应用唯一 SQLite 数据库的实时结构", schemaName: "main", tables }] };
  } finally {
    db.close();
  }
}

function datasourceFilters(query: PageQuery) {
  const keyword = likeKeyword(query.keyword);
  return {
    sql: `status = 'active'
      and (? is null or is_visible = ?)
      and (? is null or datasource_key like ? or name like ? or description like ?)`,
    args: [
      query.isVisible ?? null,
      query.isVisible === undefined ? null : boolValue(query.isVisible),
      keyword,
      keyword,
      keyword,
      keyword,
    ],
  };
}

function discoveryMap() {
  return new Map(discoverSemanticDatasources().items.map((item) => [item.key, item]));
}

function withDiscovery(row: ReturnType<typeof datasourceFrom>, discoveries: Map<string, DiscoveredSemanticDatasource>): SemanticDatasource {
  const discovered = discoveries.get(row.datasourceKey);
  return {
    ...row,
    key: row.datasourceKey,
    label: row.name,
    description: row.description ?? discovered?.description ?? "",
    schemaName: row.schemaName ?? discovered?.schemaName ?? "",
    tables: discovered?.tables ?? [],
  };
}

export async function pageDatasources(db: SemanticLayerDb, query: PageQuery) {
  const filters = datasourceFilters(query);
  const total = countFrom(
    await db.execute({
      sql: `select count(*) as total from metadata_datasources where ${filters.sql}`,
      args: filters.args,
    }),
  );
  const page = pageArgs(query);
  const result = await db.execute({
    sql: `select * from metadata_datasources where ${filters.sql}
      order by ${orderBy(query, datasourceSortMapper)} limit ? offset ?`,
    args: [...filters.args, page.limit, page.offset],
  });
  const discoveries = discoveryMap();
  return pageResult(query, total, result.rows.map((row) => withDiscovery(datasourceFrom(row), discoveries)));
}

export async function createDatasource(db: SemanticLayerDb, input: CreateDatasource) {
  const now = nowIso();
  const id = crypto.randomUUID();
  await db.execute({
    sql: `insert into metadata_datasources
      (id, datasource_key, name, description, connection_type, schema_name,
       is_visible, status, sync_status, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, 'active', 'active', ?, ?)`,
    args: [
      id,
      input.datasourceKey,
      input.name,
      nullable(input.description),
      input.connectionType,
      nullable(input.schemaName),
      boolValue(input.isVisible),
      now,
      now,
    ],
  });
  return getDatasource(db, id);
}

export async function getDatasource(db: SemanticLayerDb, id: string) {
  const result = await db.execute({
    sql: "select * from metadata_datasources where id = ? and status = 'active'",
    args: [id],
  });
  const row = result.rows[0] ? datasourceFrom(result.rows[0]) : null;
  return row ? withDiscovery(row, discoveryMap()) : null;
}

export async function updateDatasource(db: SemanticLayerDb, id: string, input: UpdateDatasource) {
  const set = buildSet({
    name: input.name,
    description: input.description === undefined ? undefined : nullable(input.description),
    connection_type: input.connectionType,
    schema_name: input.schemaName === undefined ? undefined : nullable(input.schemaName),
    is_visible: input.isVisible === undefined ? undefined : boolValue(input.isVisible),
    updated_at: nowIso(),
  });
  if (set.clause) {
    await db.execute({
      sql: `update metadata_datasources set ${set.clause}
        where id = ? and status = 'active'`,
      args: [...set.args, id],
    });
  }
  return getDatasource(db, id);
}

export async function deleteDatasources(db: SemanticLayerDb, ids: string[]) {
  const now = nowIso();
  await db.execute({
    sql: `update metadata_datasources set status = 'deleted', updated_at = ?
      where id in (${idsPlaceholders(ids)})`,
    args: [now, ...ids],
  });
  return { deleted: ids.length };
}

export async function markDatasourceSynced(db: SemanticLayerExecutor, datasourceKey: string, syncedAt: string) {
  await db.execute({
    sql: `update metadata_datasources set sync_status = 'active',
      last_synced_at = ?, updated_at = ?
      where datasource_key = ? and status = 'active'`,
    args: [syncedAt, syncedAt, datasourceKey],
  });
}
