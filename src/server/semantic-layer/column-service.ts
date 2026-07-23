import type { z } from "zod";

import type {
  createColumnSchema,
  PageQuery,
  updateColumnSchema,
} from "@/server/semantic-layer/contract";
import {
  boolValue,
  buildSet,
  idsPlaceholders,
  jsonValue,
  nullable,
  nowIso,
  requireActive,
  type SemanticLayerDb,
} from "@/server/semantic-layer/database";
import {
  columnSortMapper,
  likeKeyword,
  orderBy,
  pageArgs,
  pageResult,
} from "@/server/semantic-layer/pagination";
import { columnFrom, countFrom } from "@/server/semantic-layer/types";

type CreateColumn = z.infer<typeof createColumnSchema>;
type UpdateColumn = z.infer<typeof updateColumnSchema>;

function columnFields() {
  return "*";
}

function columnFilters(query: PageQuery, tableId?: string) {
  const keyword = likeKeyword(query.keyword);
  return {
    sql: `status = 'active'
      and (? is null or table_id = ?)
      and (? is null or is_visible = ?)
      and (? is null or physical_column_name like ?
        or semantic_name like ? or semantic_description like ?)`,
    args: [
      tableId ?? null,
      tableId ?? null,
      query.isVisible ?? null,
      query.isVisible === undefined ? null : boolValue(query.isVisible),
      keyword,
      keyword,
      keyword,
      keyword,
    ],
  };
}

export async function pageColumns(
  db: SemanticLayerDb,
  query: PageQuery,
  tableId?: string,
) {
  const filters = columnFilters(query, tableId);
  const total = countFrom(
    await db.execute({
      sql: `select count(*) as total from metadata_semantic_columns
        where ${filters.sql}`,
      args: filters.args,
    }),
  );
  const page = pageArgs(query);
  const result = await db.execute({
    sql: `select ${columnFields()} from metadata_semantic_columns
      where ${filters.sql}
      order by ${orderBy(query, columnSortMapper)} limit ? offset ?`,
    args: [...filters.args, page.limit, page.offset],
  });
  return pageResult(query, total, result.rows.map(columnFrom));
}

export async function createColumn(
  db: SemanticLayerDb,
  tableId: string,
  input: CreateColumn,
) {
  await requireActive(db, "metadata_semantic_tables", tableId);
  const now = nowIso();
  const id = crypto.randomUUID();
  await db.execute({
    sql: `insert into metadata_semantic_columns
      (id, table_id, physical_column_name, ordinal_position, data_type,
       is_nullable, is_primary_key, default_value, physical_description,
       semantic_name, semantic_description, business_type, example_values,
       is_visible, status, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    args: [
      id,
      tableId,
      input.physicalColumnName,
      input.ordinalPosition,
      input.dataType,
      boolValue(input.isNullable),
      boolValue(input.isPrimaryKey),
      nullable(input.defaultValue),
      nullable(input.physicalDescription),
      nullable(input.semanticName),
      nullable(input.semanticDescription),
      nullable(input.businessType),
      jsonValue(input.exampleValues),
      boolValue(input.isVisible),
      now,
      now,
    ],
  });
  return getColumn(db, id);
}

export async function getColumn(db: SemanticLayerDb, id: string) {
  const result = await db.execute({
    sql: `select ${columnFields()} from metadata_semantic_columns
      where id = ? and status = 'active'`,
    args: [id],
  });
  return result.rows[0] ? columnFrom(result.rows[0]) : null;
}

export async function updateColumn(
  db: SemanticLayerDb,
  id: string,
  input: UpdateColumn,
) {
  const set = buildSet({
    semantic_name:
      input.semanticName === undefined ? undefined : nullable(input.semanticName),
    semantic_description:
      input.semanticDescription === undefined
        ? undefined
        : nullable(input.semanticDescription),
    business_type:
      input.businessType === undefined ? undefined : nullable(input.businessType),
    example_values:
      input.exampleValues === undefined ? undefined : jsonValue(input.exampleValues),
    is_visible:
      input.isVisible === undefined ? undefined : boolValue(input.isVisible),
    updated_at: nowIso(),
  });
  if (set.clause) {
    await db.execute({
      sql: `update metadata_semantic_columns set ${set.clause}
        where id = ? and status = 'active'`,
      args: [...set.args, id],
    });
  }
  return getColumn(db, id);
}

export async function deleteColumns(db: SemanticLayerDb, ids: string[]) {
  const now = nowIso();
  const placeholders = idsPlaceholders(ids);
  await db.batch(
    [
      {
        sql: `update metadata_semantic_columns set status = 'deleted', updated_at = ?
          where id in (${placeholders})`,
        args: [now, ...ids],
      },
      {
        sql: `update metadata_logical_foreign_keys set status = 'deleted',
          updated_at = ? where source_column_id in (${placeholders})
          or target_column_id in (${placeholders})`,
        args: [now, ...ids, ...ids],
      },
    ],
    "write",
  );
  return { deleted: ids.length };
}
