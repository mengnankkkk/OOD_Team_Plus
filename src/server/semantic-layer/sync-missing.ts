import type { InValue } from "@libsql/client";

import type { SemanticLayerExecutor } from "@/server/semantic-layer/database";
import type { SyncInput } from "@/server/semantic-layer/sync-types";

async function markMissing(
  db: SemanticLayerExecutor,
  table: string,
  whereSql: string,
  args: InValue[],
) {
  const result = await db.execute({
    sql: `update ${table} set sync_status = 'missing', updated_at = ?
      where status = 'active' and sync_status = 'active' and ${whereSql}`,
    args,
  });
  return result.rowsAffected;
}

function placeholders(ids: string[]) {
  return ids.map(() => "?").join(", ") || "''";
}

export async function markMissingTables(
  db: SemanticLayerExecutor,
  input: SyncInput,
  domainId: string,
  ids: string[],
  now: string,
) {
  return markMissing(
    db,
    "metadata_semantic_tables",
    `domain_id = ? and datasource_key = ? and coalesce(schema_name, '') = ?
      and id not in (${placeholders(ids)})`,
    [now, domainId, input.datasourceKey, input.schemaName ?? "", ...ids],
  );
}

export async function markMissingColumns(
  db: SemanticLayerExecutor,
  tableId: string,
  ids: string[],
  now: string,
) {
  return markMissing(
    db,
    "metadata_semantic_columns",
    `table_id = ? and id not in (${placeholders(ids)})`,
    [now, tableId, ...ids],
  );
}

export async function markMissingForeignKeys(
  db: SemanticLayerExecutor,
  tableIds: string[],
  fkIds: string[],
  now: string,
) {
  if (tableIds.length === 0) {
    return 0;
  }
  return markMissing(
    db,
    "metadata_logical_foreign_keys",
    `source_type = 'physical'
      and source_table_id in (${placeholders(tableIds)})
      and id not in (${placeholders(fkIds)})`,
    [now, ...tableIds, ...fkIds],
  );
}
