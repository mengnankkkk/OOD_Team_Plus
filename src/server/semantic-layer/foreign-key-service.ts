import type { z } from "zod";

import type {
  createForeignKeySchema,
  PageQuery,
  updateForeignKeySchema,
} from "@/server/semantic-layer/contract";
import {
  boolValue,
  buildSet,
  idsPlaceholders,
  nullable,
  nowIso,
  requireActive,
  type SemanticLayerDb,
} from "@/server/semantic-layer/database";
import {
  foreignKeySortMapper,
  likeKeyword,
  orderBy,
  pageArgs,
  pageResult,
} from "@/server/semantic-layer/pagination";
import { countFrom, foreignKeyFrom } from "@/server/semantic-layer/types";

type CreateForeignKey = z.infer<typeof createForeignKeySchema>;
type UpdateForeignKey = z.infer<typeof updateForeignKeySchema>;

function fkFields() {
  return `fk.*,
    coalesce(source_table.semantic_name, source_table.physical_table_name)
      as source_table_name,
    coalesce(target_table.semantic_name, target_table.physical_table_name)
      as target_table_name,
    coalesce(source_column.semantic_name, source_column.physical_column_name)
      as source_column_name,
    coalesce(target_column.semantic_name, target_column.physical_column_name)
      as target_column_name`;
}

function fkJoin() {
  return `metadata_logical_foreign_keys fk
    join metadata_semantic_tables source_table
      on source_table.id = fk.source_table_id
    join metadata_semantic_tables target_table
      on target_table.id = fk.target_table_id
    join metadata_semantic_columns source_column
      on source_column.id = fk.source_column_id
    join metadata_semantic_columns target_column
      on target_column.id = fk.target_column_id`;
}

function fkFilters(query: PageQuery, sourceTableId?: string, targetTableId?: string) {
  const keyword = likeKeyword(query.keyword);
  return {
    sql: `fk.status = 'active'
      and (? is null or fk.source_table_id = ?)
      and (? is null or fk.target_table_id = ?)
      and (? is null or fk.is_visible = ?)
      and (? is null or fk.semantic_description like ?
        or source_column.physical_column_name like ?
        or target_column.physical_column_name like ?)`,
    args: [
      sourceTableId ?? null,
      sourceTableId ?? null,
      targetTableId ?? null,
      targetTableId ?? null,
      query.isVisible ?? null,
      query.isVisible === undefined ? null : boolValue(query.isVisible),
      keyword,
      keyword,
      keyword,
      keyword,
    ],
  };
}

async function requireColumnOnTable(
  db: SemanticLayerDb,
  columnId: string,
  tableId: string,
) {
  const result = await db.execute({
    sql: `select id from metadata_semantic_columns
      where id = ? and table_id = ? and status = 'active'`,
    args: [columnId, tableId],
  });
  if (result.rows.length === 0) {
    throw new Error(`Column ${columnId} does not belong to table ${tableId}`);
  }
}

export async function pageForeignKeys(
  db: SemanticLayerDb,
  query: PageQuery,
  sourceTableId?: string,
  targetTableId?: string,
) {
  const filters = fkFilters(query, sourceTableId, targetTableId);
  const total = countFrom(
    await db.execute({
      sql: `select count(*) as total from ${fkJoin()} where ${filters.sql}`,
      args: filters.args,
    }),
  );
  const page = pageArgs(query);
  const result = await db.execute({
    sql: `select ${fkFields()} from ${fkJoin()} where ${filters.sql}
      order by ${orderBy(query, foreignKeySortMapper)} limit ? offset ?`,
    args: [...filters.args, page.limit, page.offset],
  });
  return pageResult(query, total, result.rows.map(foreignKeyFrom));
}

export async function createForeignKey(
  db: SemanticLayerDb,
  input: CreateForeignKey,
) {
  await requireActive(db, "metadata_semantic_tables", input.sourceTableId);
  await requireActive(db, "metadata_semantic_tables", input.targetTableId);
  await requireColumnOnTable(db, input.sourceColumnId, input.sourceTableId);
  await requireColumnOnTable(db, input.targetColumnId, input.targetTableId);
  const now = nowIso();
  const id = crypto.randomUUID();
  await db.execute({
    sql: `insert into metadata_logical_foreign_keys
      (id, source_table_id, source_column_id, target_table_id, target_column_id,
       relation_type, source_type, confidence, physical_description,
       semantic_description, is_visible, status, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    args: [
      id,
      input.sourceTableId,
      input.sourceColumnId,
      input.targetTableId,
      input.targetColumnId,
      input.relationType,
      input.sourceType,
      input.confidence,
      nullable(input.physicalDescription),
      nullable(input.semanticDescription),
      boolValue(input.isVisible),
      now,
      now,
    ],
  });
  return getForeignKey(db, id);
}

export async function getForeignKey(db: SemanticLayerDb, id: string) {
  const result = await db.execute({
    sql: `select ${fkFields()} from ${fkJoin()}
      where fk.id = ? and fk.status = 'active'`,
    args: [id],
  });
  return result.rows[0] ? foreignKeyFrom(result.rows[0]) : null;
}

export async function updateForeignKey(
  db: SemanticLayerDb,
  id: string,
  input: UpdateForeignKey,
) {
  const set = buildSet({
    relation_type: input.relationType,
    confidence: input.confidence,
    physical_description:
      input.physicalDescription === undefined
        ? undefined
        : nullable(input.physicalDescription),
    semantic_description:
      input.semanticDescription === undefined
        ? undefined
        : nullable(input.semanticDescription),
    is_visible:
      input.isVisible === undefined ? undefined : boolValue(input.isVisible),
    updated_at: nowIso(),
  });
  if (set.clause) {
    await db.execute({
      sql: `update metadata_logical_foreign_keys set ${set.clause}
        where id = ? and status = 'active'`,
      args: [...set.args, id],
    });
  }
  return getForeignKey(db, id);
}

export async function deleteForeignKeys(db: SemanticLayerDb, ids: string[]) {
  await db.execute({
    sql: `update metadata_logical_foreign_keys
      set status = 'deleted', updated_at = ?
      where id in (${idsPlaceholders(ids)})`,
    args: [nowIso(), ...ids],
  });
  return { deleted: ids.length };
}
