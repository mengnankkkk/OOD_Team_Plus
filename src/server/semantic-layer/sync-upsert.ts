import {
  boolValue,
  nullable,
  type SemanticLayerExecutor,
} from "@/server/semantic-layer/database";
import type {
  SyncColumn,
  SyncInput,
  SyncTable,
} from "@/server/semantic-layer/sync-types";

export async function upsertDomain(
  db: SemanticLayerExecutor,
  input: SyncInput,
  now: string,
) {
  const existing = await db.execute({
    sql: "select id from metadata_domains where name = ? limit 1",
    args: [input.domain.name],
  });
  const id = (existing.rows[0]?.id as string | undefined) ?? crypto.randomUUID();
  if (existing.rows[0]) {
    await db.execute({
      sql: `update metadata_domains set name = ?,
        description = coalesce(description, ?), status = 'active', updated_at = ?
        where id = ?`,
      args: [input.domain.name, nullable(input.domain.description), now, id],
    });
    return { id, created: false };
  }
  await db.execute({
    sql: `insert into metadata_domains
      (id, name, description, is_visible, status, created_at, updated_at)
      values (?, ?, ?, ?, 'active', ?, ?)`,
    args: [
      id,
      input.domain.name,
      nullable(input.domain.description),
      boolValue(input.domain.isVisible),
      now,
      now,
    ],
  });
  return { id, created: true };
}

export async function upsertTable(
  db: SemanticLayerExecutor,
  input: SyncInput,
  domainId: string,
  table: SyncTable,
  now: string,
) {
  const existing = await db.execute({
    sql: `select id from metadata_semantic_tables
      where datasource_key = ? and coalesce(schema_name, '') = ?
        and physical_table_name = ? limit 1`,
    args: [input.datasourceKey, input.schemaName ?? "", table.physicalTableName],
  });
  const id = (existing.rows[0]?.id as string | undefined) ?? crypto.randomUUID();
  if (existing.rows[0]) {
    await updateTable(db, id, domainId, table, now);
    return { id, created: false };
  }
  await insertTable(db, id, input, domainId, table, now);
  return { id, created: true };
}

async function updateTable(
  db: SemanticLayerExecutor,
  id: string,
  domainId: string,
  table: SyncTable,
  now: string,
) {
  await db.execute({
    sql: `update metadata_semantic_tables set domain_id = ?,
      physical_description = ?, semantic_name = coalesce(semantic_name, ?),
      semantic_description = coalesce(semantic_description, ?),
      status = 'active', sync_status = 'active',
      last_synced_at = ?, updated_at = ? where id = ?`,
    args: [
      domainId,
      nullable(table.physicalDescription),
      nullable(table.semanticName),
      nullable(table.semanticDescription),
      now,
      now,
      id,
    ],
  });
}

async function insertTable(
  db: SemanticLayerExecutor,
  id: string,
  input: SyncInput,
  domainId: string,
  table: SyncTable,
  now: string,
) {
  await db.execute({
    sql: `insert into metadata_semantic_tables
      (id, domain_id, datasource_key, schema_name, physical_table_name,
       physical_description, semantic_name, semantic_description,
       is_visible, status, sync_status,
       last_synced_at, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'active', ?, ?, ?)`,
    args: [
      id,
      domainId,
      input.datasourceKey,
      nullable(input.schemaName),
      table.physicalTableName,
      nullable(table.physicalDescription),
      nullable(table.semanticName),
      nullable(table.semanticDescription),
      boolValue(table.isVisible ?? true),
      now,
      now,
      now,
    ],
  });
}

export async function upsertColumn(
  db: SemanticLayerExecutor,
  tableId: string,
  column: SyncColumn,
  now: string,
) {
  const existing = await db.execute({
    sql: `select id from metadata_semantic_columns
      where table_id = ? and physical_column_name = ? limit 1`,
    args: [tableId, column.physicalColumnName],
  });
  const id = (existing.rows[0]?.id as string | undefined) ?? crypto.randomUUID();
  if (existing.rows[0]) {
    await updateColumn(db, id, column, now);
    return { id, created: false };
  }
  await insertColumn(db, id, tableId, column, now);
  return { id, created: true };
}

function physicalColumnArgs(column: SyncColumn) {
  return [
    column.ordinalPosition,
    column.dataType,
    boolValue(column.isNullable),
    boolValue(column.isPrimaryKey),
    nullable(column.defaultValue),
    nullable(column.physicalDescription),
  ];
}

async function updateColumn(
  db: SemanticLayerExecutor,
  id: string,
  column: SyncColumn,
  now: string,
) {
  await db.execute({
    sql: `update metadata_semantic_columns set ordinal_position = ?,
      data_type = ?, is_nullable = ?, is_primary_key = ?, default_value = ?,
      physical_description = ?, semantic_name = coalesce(semantic_name, ?),
      semantic_description = coalesce(semantic_description, ?),
      business_type = coalesce(business_type, ?),
      example_values = coalesce(example_values, ?),
      status = 'active', sync_status = 'active',
      last_synced_at = ?, updated_at = ? where id = ?`,
    args: [
      ...physicalColumnArgs(column),
      nullable(column.semanticName),
      nullable(column.semanticDescription),
      nullable(column.businessType),
      column.exampleValues ? JSON.stringify(column.exampleValues) : null,
      now,
      now,
      id,
    ],
  });
}

async function insertColumn(
  db: SemanticLayerExecutor,
  id: string,
  tableId: string,
  column: SyncColumn,
  now: string,
) {
  await db.execute({
    sql: `insert into metadata_semantic_columns
      (id, table_id, physical_column_name, ordinal_position, data_type,
      is_nullable, is_primary_key, default_value, physical_description,
       semantic_name, semantic_description, business_type, example_values,
       is_visible, status, sync_status, last_synced_at,
       created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active',
        'active', ?, ?, ?)`,
    args: [
      id,
      tableId,
      column.physicalColumnName,
      ...physicalColumnArgs(column),
      nullable(column.semanticName),
      nullable(column.semanticDescription),
      nullable(column.businessType),
      column.exampleValues ? JSON.stringify(column.exampleValues) : null,
      boolValue(column.isVisible ?? true),
      now,
      now,
      now,
    ],
  });
}
