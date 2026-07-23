import type { z } from "zod";

import type {
  createTableSchema,
  PageQuery,
  updateTableSchema,
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
  likeKeyword,
  orderBy,
  pageArgs,
  pageResult,
  tableSortMapper,
} from "@/server/semantic-layer/pagination";
import { countFrom, tableFrom } from "@/server/semantic-layer/types";

type CreateTable = z.infer<typeof createTableSchema>;
type UpdateTable = z.infer<typeof updateTableSchema>;

function tableFields() {
  return "t.*";
}

function tableFilters(query: PageQuery, domainId?: string) {
  const keyword = likeKeyword(query.keyword);
  return {
    sql: `t.status = 'active' and d.status = 'active'
      and (? is null or t.domain_id = ?)
      and (? is null or t.is_visible = ?)
      and (? is null or t.physical_table_name like ?
        or t.semantic_name like ? or t.semantic_description like ?)`,
    args: [
      domainId ?? null,
      domainId ?? null,
      query.isVisible ?? null,
      query.isVisible === undefined ? null : boolValue(query.isVisible),
      keyword,
      keyword,
      keyword,
      keyword,
    ],
  };
}

export async function pageTables(
  db: SemanticLayerDb,
  query: PageQuery,
  domainId?: string,
) {
  const filters = tableFilters(query, domainId);
  const total = countFrom(
    await db.execute({
      sql: `select count(*) as total from metadata_semantic_tables t
        join metadata_domains d on d.id = t.domain_id where ${filters.sql}`,
      args: filters.args,
    }),
  );
  const page = pageArgs(query);
  const result = await db.execute({
    sql: `select ${tableFields()} from metadata_semantic_tables t
      join metadata_domains d on d.id = t.domain_id where ${filters.sql}
      order by ${orderBy(query, tableSortMapper)} limit ? offset ?`,
    args: [...filters.args, page.limit, page.offset],
  });
  return pageResult(query, total, result.rows.map(tableFrom));
}

export async function createTable(db: SemanticLayerDb, input: CreateTable) {
  await requireActive(db, "metadata_domains", input.domainId);
  const now = nowIso();
  const id = crypto.randomUUID();
  await db.execute({
    sql: `insert into metadata_semantic_tables
      (id, domain_id, datasource_key, schema_name, physical_table_name,
       physical_description, semantic_name, semantic_description,
       is_visible, status, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    args: [
      id,
      input.domainId,
      input.datasourceKey,
      nullable(input.schemaName),
      input.physicalTableName,
      nullable(input.physicalDescription),
      nullable(input.semanticName),
      nullable(input.semanticDescription),
      boolValue(input.isVisible),
      now,
      now,
    ],
  });
  return getTable(db, id);
}

export async function getTable(db: SemanticLayerDb, id: string) {
  const result = await db.execute({
    sql: `select ${tableFields()} from metadata_semantic_tables t
      join metadata_domains d on d.id = t.domain_id
      where t.id = ? and t.status = 'active'`,
    args: [id],
  });
  return result.rows[0] ? tableFrom(result.rows[0]) : null;
}

export async function updateTable(
  db: SemanticLayerDb,
  id: string,
  input: UpdateTable,
) {
  const set = buildSet({
    semantic_name:
      input.semanticName === undefined ? undefined : nullable(input.semanticName),
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
      sql: `update metadata_semantic_tables set ${set.clause}
        where id = ? and status = 'active'`,
      args: [...set.args, id],
    });
  }
  return getTable(db, id);
}

export async function deleteTables(db: SemanticLayerDb, ids: string[]) {
  const now = nowIso();
  const placeholders = idsPlaceholders(ids);
  await db.batch(
    [
      {
        sql: `update metadata_semantic_tables set status = 'deleted', updated_at = ?
          where id in (${placeholders})`,
        args: [now, ...ids],
      },
      {
        sql: `update metadata_semantic_columns set status = 'deleted', updated_at = ?
          where table_id in (${placeholders})`,
        args: [now, ...ids],
      },
      {
        sql: `update metadata_logical_foreign_keys set status = 'deleted',
          updated_at = ? where source_table_id in (${placeholders})
          or target_table_id in (${placeholders})`,
        args: [now, ...ids, ...ids],
      },
    ],
    "write",
  );
  return { deleted: ids.length };
}
