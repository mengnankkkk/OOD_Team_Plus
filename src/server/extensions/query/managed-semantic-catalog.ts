import type { SqliteDb } from "@/server/db/client.runtime";

import { SEMANTIC_DATASETS, type SemanticDatasetKey } from "./semantic-catalog";
import type { QueryPlan } from "./types";

type ManagedTable = {
  id: string;
  domainId: string;
  domainName: string;
  physicalTableName: string;
  semanticName: string | null;
  semanticDescription: string | null;
};

type ManagedColumn = {
  tableId: string;
  physicalColumnName: string;
  semanticName: string | null;
  semanticDescription: string | null;
  businessType: string | null;
};

type ManagedForeignKey = {
  sourceTableId: string;
  sourceColumnId: string;
  targetTableId: string;
  targetColumnId: string;
  relationType: string;
  semanticDescription: string | null;
};

export type ManagedSemanticContext = {
  tables: ManagedTable[];
  columns: ManagedColumn[];
  logicalForeignKeys: ManagedForeignKey[];
};

export function loadManagedSemanticContext(db?: SqliteDb): ManagedSemanticContext | null {
  if (!db) return null;
  const allowedTables = new Set(Object.values(SEMANTIC_DATASETS).flatMap((dataset) => dataset.tables));
  const tables = db.prepare(`SELECT t.id,t.domain_id AS domainId,d.name AS domainName,
      t.physical_table_name AS physicalTableName,t.semantic_name AS semanticName,
      t.semantic_description AS semanticDescription
    FROM metadata_semantic_tables t JOIN metadata_domains d ON d.id=t.domain_id
    WHERE t.status='active' AND t.is_visible=1 AND d.status='active' AND d.is_visible=1`).all() as ManagedTable[];
  const trustedTables = tables.filter((table) => allowedTables.has(table.physicalTableName));
  if (!trustedTables.length) return { tables: [], columns: [], logicalForeignKeys: [] };
  const tableIds = new Set(trustedTables.map((table) => table.id));
  const columns = (db.prepare(`SELECT table_id AS tableId,physical_column_name AS physicalColumnName,
      semantic_name AS semanticName,semantic_description AS semanticDescription,business_type AS businessType
    FROM metadata_semantic_columns WHERE status='active' AND is_visible=1 ORDER BY ordinal_position`).all() as ManagedColumn[])
    .filter((column) => tableIds.has(column.tableId));
  const logicalForeignKeys = (db.prepare(`SELECT source_table_id AS sourceTableId,source_column_id AS sourceColumnId,
      target_table_id AS targetTableId,target_column_id AS targetColumnId,relation_type AS relationType,
      semantic_description AS semanticDescription
    FROM metadata_logical_foreign_keys WHERE status='active' AND is_visible=1`).all() as ManagedForeignKey[])
    .filter((foreignKey) => tableIds.has(foreignKey.sourceTableId) && tableIds.has(foreignKey.targetTableId));
  return { tables: trustedTables, columns, logicalForeignKeys };
}

export function canonicalizeManagedPlan(
  plan: QueryPlan,
  datasetKey: SemanticDatasetKey,
  context: ManagedSemanticContext | null,
): QueryPlan {
  if (!context?.tables.length) return plan;
  const dataset = SEMANTIC_DATASETS[datasetKey];
  const tableIds = new Set(context.tables.filter((table) => dataset.tables.includes(table.physicalTableName)).map((table) => table.id));
  const aliases = new Map<string, string>();
  for (const canonical of Object.keys(dataset.columns)) aliases.set(normalize(canonical), canonical);
  for (const column of context.columns.filter((item) => tableIds.has(item.tableId))) {
    const canonical = findCanonicalColumn(dataset.columns, column.physicalColumnName);
    if (!canonical) continue;
    aliases.set(normalize(column.physicalColumnName), canonical);
    if (column.semanticName) aliases.set(normalize(column.semanticName), canonical);
  }
  const resolve = (value: string) => aliases.get(normalize(value)) ?? value;
  const order = plan.orderBy?.trim().match(/^(.+?)(?:\s+(ASC|DESC))?$/iu);
  return {
    ...plan,
    dimensions: plan.dimensions.map(resolve),
    filters: plan.filters.map((filter) => ({ ...filter, column: resolve(filter.column) })),
    orderBy: order ? `${resolve(order[1])}${order[2] ? ` ${order[2].toUpperCase()}` : ""}` : plan.orderBy,
  };
}

function findCanonicalColumn(columns: Record<string, string>, physicalColumn: string): string | null {
  const token = new RegExp(`(?:^|\\.)${escapeRegex(physicalColumn)}\\b`, "iu");
  return Object.entries(columns).find(([, expression]) => token.test(expression))?.[0] ?? null;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN").replace(/[\s_-]+/gu, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
