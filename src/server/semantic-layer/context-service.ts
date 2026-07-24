import type { SemanticLayerDb } from "@/server/semantic-layer/database";
import { columnFrom, foreignKeyFrom, tableFrom } from "@/server/semantic-layer/types";

export async function getSemanticTableContext(
  db: SemanticLayerDb,
  tableId: string,
) {
  const tableResult = await db.execute({
    sql: `select t.*
      from metadata_semantic_tables t
      join metadata_domains d on d.id = t.domain_id
      where t.id = ? and t.status = 'active' and t.is_visible = 1
        and t.sync_status = 'active'
        and d.status = 'active' and d.is_visible = 1`,
    args: [tableId],
  });
  const tableRow = tableResult.rows[0];
  if (!tableRow) {
    return null;
  }

  const columns = await db.execute({
    sql: `select *
      from metadata_semantic_columns
      where table_id = ? and status = 'active' and is_visible = 1
        and sync_status = 'active'
      order by ordinal_position asc`,
    args: [tableId],
  });

  const relations = await db.execute({
    sql: `select fk.*,
      coalesce(source_table.semantic_name, source_table.physical_table_name)
        as source_table_name,
      coalesce(target_table.semantic_name, target_table.physical_table_name)
        as target_table_name,
      coalesce(source_column.semantic_name, source_column.physical_column_name)
        as source_column_name,
      coalesce(target_column.semantic_name, target_column.physical_column_name)
        as target_column_name
      from metadata_logical_foreign_keys fk
      join metadata_semantic_tables source_table
        on source_table.id = fk.source_table_id
      join metadata_semantic_tables target_table
        on target_table.id = fk.target_table_id
      join metadata_semantic_columns source_column
        on source_column.id = fk.source_column_id
      join metadata_semantic_columns target_column
        on target_column.id = fk.target_column_id
      where fk.status = 'active' and fk.is_visible = 1
        and fk.sync_status = 'active'
        and (fk.source_table_id = ? or fk.target_table_id = ?)`,
    args: [tableId, tableId],
  });

  const table = tableFrom(tableRow);
  return {
    table,
    columns: columns.rows.map(columnFrom),
    relations: relations.rows.map(foreignKeyFrom),
  };
}
