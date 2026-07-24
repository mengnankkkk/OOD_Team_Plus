import type { z } from "zod";

import type {
  createDomainSchema,
  updateDomainSchema,
} from "@/server/semantic-layer/contract";
import type { PageQuery } from "@/server/semantic-layer/contract";
import {
  boolValue,
  buildSet,
  idsPlaceholders,
  nullable,
  nowIso,
  type SemanticLayerDb,
} from "@/server/semantic-layer/database";
import {
  domainSortMapper,
  likeKeyword,
  orderBy,
  pageArgs,
  pageResult,
} from "@/server/semantic-layer/pagination";
import { countFrom, domainFrom } from "@/server/semantic-layer/types";

type CreateDomain = z.infer<typeof createDomainSchema>;
type UpdateDomain = z.infer<typeof updateDomainSchema>;

export async function pageDomains(db: SemanticLayerDb, query: PageQuery) {
  const keyword = likeKeyword(query.keyword);
  const filters =
    "status = 'active' and (? is null or is_visible = ?) and " +
    "(? is null or name like ? or description like ?)";
  const args = [
    query.isVisible ?? null,
    query.isVisible === undefined ? null : boolValue(query.isVisible),
    keyword,
    keyword,
    keyword,
  ];
  const total = countFrom(
    await db.execute({
      sql: `select count(*) as total from metadata_domains where ${filters}`,
      args,
    }),
  );
  const page = pageArgs(query);
  const result = await db.execute({
    sql: `select * from metadata_domains where ${filters}
      order by ${orderBy(query, domainSortMapper)} limit ? offset ?`,
    args: [...args, page.limit, page.offset],
  });
  return pageResult(query, total, result.rows.map(domainFrom));
}

export async function createDomain(db: SemanticLayerDb, input: CreateDomain) {
  const now = nowIso();
  const id = crypto.randomUUID();
  await db.execute({
    sql: `insert into metadata_domains
      (id, name, description, is_visible, status, created_at, updated_at)
      values (?, ?, ?, ?, 'active', ?, ?)`,
    args: [
      id,
      input.name,
      nullable(input.description),
      boolValue(input.isVisible),
      now,
      now,
    ],
  });
  return getDomain(db, id);
}

export async function getDomain(db: SemanticLayerDb, id: string) {
  const result = await db.execute({
    sql: "select * from metadata_domains where id = ? and status = 'active'",
    args: [id],
  });
  return result.rows[0] ? domainFrom(result.rows[0]) : null;
}

export async function updateDomain(
  db: SemanticLayerDb,
  id: string,
  input: UpdateDomain,
) {
  const set = buildSet({
    name: input.name,
    description:
      input.description === undefined ? undefined : nullable(input.description),
    is_visible:
      input.isVisible === undefined ? undefined : boolValue(input.isVisible),
    updated_at: nowIso(),
  });
  if (set.clause) {
    await db.execute({
      sql: `update metadata_domains set ${set.clause}
        where id = ? and status = 'active'`,
      args: [...set.args, id],
    });
  }
  return getDomain(db, id);
}

export async function deleteDomains(db: SemanticLayerDb, ids: string[]) {
  const now = nowIso();
  await db.batch(
    [
      {
        sql: `update metadata_domains set status = 'deleted', updated_at = ?
          where id in (${idsPlaceholders(ids)})`,
        args: [now, ...ids],
      },
      {
        sql: `update metadata_semantic_tables set status = 'deleted', updated_at = ?
          where domain_id in (${idsPlaceholders(ids)})`,
        args: [now, ...ids],
      },
      {
        sql: `update metadata_semantic_columns set status = 'deleted', updated_at = ?
          where table_id in (
            select id from metadata_semantic_tables
            where domain_id in (${idsPlaceholders(ids)})
          )`,
        args: [now, ...ids],
      },
      {
        sql: `update metadata_logical_foreign_keys set status = 'deleted',
          updated_at = ? where source_table_id in (
            select id from metadata_semantic_tables
            where domain_id in (${idsPlaceholders(ids)})
          ) or target_table_id in (
            select id from metadata_semantic_tables
            where domain_id in (${idsPlaceholders(ids)})
          )`,
        args: [now, ...ids, ...ids],
      },
    ],
    "write",
  );
  return { deleted: ids.length };
}
