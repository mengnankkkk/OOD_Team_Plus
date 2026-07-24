import { sb } from "@/services/supabaseClient";
import type {
  ColumnListQuery,
  ColumnSortField,
  DomainListQuery,
  DomainSortField,
  ForeignKeyListQuery,
  ForeignKeySortField,
  IsVisibleFilter,
  PagedResult,
  SemanticColumn,
  SemanticColumnInput,
  SemanticDomain,
  SemanticDomainInput,
  SemanticForeignKey,
  SemanticForeignKeyInput,
  SemanticTable,
  SemanticTableInput,
  SortOrder,
  SyncCounter,
  SyncPayload,
  SyncResult,
  TableListQuery,
  TableSortField,
} from "@/types/app/semantic";

// ---------- Row mappers ----------

const domainRow = (row: any): SemanticDomain => ({
  id: row.id,
  name: row.name,
  description: row.description,
  isVisible: !!row.is_visible,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const tableRow = (row: any): SemanticTable => ({
  id: row.id,
  domainId: row.domain_id,
  datasourceKey: row.datasource_key,
  schemaName: row.schema_name,
  physicalTableName: row.physical_table_name,
  physicalDescription: row.physical_description,
  semanticName: row.semantic_name,
  semanticDescription: row.semantic_description,
  isVisible: !!row.is_visible,
  syncStatus: row.sync_status ?? "active",
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const columnRow = (row: any): SemanticColumn => ({
  id: row.id,
  tableId: row.table_id,
  physicalColumnName: row.physical_column_name,
  ordinalPosition: row.ordinal_position,
  dataType: row.data_type,
  isNullable: !!row.is_nullable,
  isPrimaryKey: !!row.is_primary_key,
  defaultValue: row.default_value,
  physicalDescription: row.physical_description,
  semanticName: row.semantic_name,
  semanticDescription: row.semantic_description,
  businessType: row.business_type,
  exampleValues: Array.isArray(row.example_values) ? row.example_values.map(String) : [],
  isVisible: !!row.is_visible,
  syncStatus: row.sync_status ?? "active",
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const fkRow = (row: any): SemanticForeignKey => ({
  id: row.id,
  sourceTableId: row.source_table_id,
  sourceColumnId: row.source_column_id,
  targetTableId: row.target_table_id,
  targetColumnId: row.target_column_id,
  relationType: row.relation_type,
  sourceType: row.source_type,
  confidence: Number(row.confidence ?? 1),
  physicalDescription: row.physical_description,
  semanticDescription: row.semantic_description,
  isVisible: !!row.is_visible,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// ---------- Query helpers ----------

const PAGE_SIZE_MIN = 10;
const PAGE_SIZE_MAX = 50;
const DEFAULT_PAGE_SIZE = 20;

const normalizePaging = (pageNo?: number, pageSize?: number) => {
  const size = Math.max(PAGE_SIZE_MIN, Math.min(PAGE_SIZE_MAX, pageSize ?? DEFAULT_PAGE_SIZE));
  const no = Math.max(1, pageNo ?? 1);
  return { pageNo: no, pageSize: size, offset: (no - 1) * size };
};

const applyVisibleFilter = (q: any, isVisible?: IsVisibleFilter) => {
  if (isVisible === "visible") return q.eq("is_visible", true);
  if (isVisible === "hidden") return q.eq("is_visible", false);
  return q;
};

const orderTuple = (col: string, order: SortOrder | undefined) => ({
  column: col,
  ascending: order === "asc",
});

const domainSortMap: Record<DomainSortField, string> = {
  updatedAt: "updated_at",
  createdAt: "created_at",
  name: "name",
};

const tableSortMap: Record<TableSortField, string> = {
  updatedAt: "updated_at",
  createdAt: "created_at",
  physicalTableName: "physical_table_name",
  semanticName: "semantic_name",
};

const columnSortMap: Record<ColumnSortField, string> = {
  ordinalPosition: "ordinal_position",
  updatedAt: "updated_at",
  createdAt: "created_at",
  physicalColumnName: "physical_column_name",
  semanticName: "semantic_name",
};

const fkSortMap: Record<ForeignKeySortField, string> = {
  updatedAt: "updated_at",
  createdAt: "created_at",
  confidence: "confidence",
};

const escapeIlike = (s: string) => s.replace(/[%_,]/g, "");

// ---------- Domains ----------

export async function listDomains(
  userId: string,
  query: DomainListQuery = {},
): Promise<PagedResult<SemanticDomain>> {
  const { pageNo, pageSize, offset } = normalizePaging(query.pageNo, query.pageSize);
  const sortCol = domainSortMap[query.sortBy ?? "updatedAt"] ?? "updated_at";
  const { column, ascending } = orderTuple(sortCol, query.sortOrder ?? "desc");

  let q = sb
    .from("semantic_domains")
    .select("*", { count: "exact" })
    .eq("user_id", userId);
  q = applyVisibleFilter(q, query.isVisible);
  if (query.keyword && query.keyword.trim()) {
    const kw = escapeIlike(query.keyword.trim());
    q = q.or(`name.ilike.%${kw}%,description.ilike.%${kw}%`);
  }
  const { data, error, count } = await q.order(column, { ascending }).range(offset, offset + pageSize - 1);
  if (error) throw error;
  return {
    pageNo,
    pageSize,
    total: count ?? 0,
    items: (data ?? []).map(domainRow),
  };
}

export async function createDomain(userId: string, input: SemanticDomainInput): Promise<SemanticDomain> {
  const { data, error } = await sb
    .from("semantic_domains")
    .insert({
      user_id: userId,
      name: input.name,
      description: input.description ?? null,
      is_visible: input.isVisible ?? true,
    })
    .select("*")
    .single();
  if (error) throw error;
  return domainRow(data);
}

export async function updateDomain(
  userId: string,
  domainId: string,
  patch: Partial<SemanticDomainInput>,
): Promise<SemanticDomain> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.description !== undefined) payload.description = patch.description;
  if (patch.isVisible !== undefined) payload.is_visible = patch.isVisible;
  const { data, error } = await sb
    .from("semantic_domains")
    .update(payload)
    .eq("user_id", userId)
    .eq("id", domainId)
    .select("*")
    .single();
  if (error) throw error;
  return domainRow(data);
}

export async function deleteDomain(userId: string, domainId: string): Promise<void> {
  const { error } = await sb.from("semantic_domains").delete().eq("user_id", userId).eq("id", domainId);
  if (error) throw error;
}

export async function batchDeleteDomains(userId: string, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const { error, count } = await sb
    .from("semantic_domains")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .in("id", ids);
  if (error) throw error;
  return count ?? 0;
}

export async function listAllDomains(userId: string): Promise<SemanticDomain[]> {
  const { data, error } = await sb
    .from("semantic_domains")
    .select("*")
    .eq("user_id", userId)
    .order("name", { ascending: true })
    .range(0, 499);
  if (error) throw error;
  return (data ?? []).map(domainRow);
}

// ---------- Tables ----------

export async function listTables(
  userId: string,
  query: TableListQuery = {},
): Promise<PagedResult<SemanticTable>> {
  const { pageNo, pageSize, offset } = normalizePaging(query.pageNo, query.pageSize);
  const sortCol = tableSortMap[query.sortBy ?? "updatedAt"] ?? "updated_at";
  const { column, ascending } = orderTuple(sortCol, query.sortOrder ?? "desc");

  let q = sb.from("semantic_tables").select("*", { count: "exact" }).eq("user_id", userId);
  if (query.domainId) q = q.eq("domain_id", query.domainId);
  q = applyVisibleFilter(q, query.isVisible);
  if (query.keyword && query.keyword.trim()) {
    const kw = escapeIlike(query.keyword.trim());
    q = q.or(
      `physical_table_name.ilike.%${kw}%,semantic_name.ilike.%${kw}%,physical_description.ilike.%${kw}%,semantic_description.ilike.%${kw}%`,
    );
  }
  const { data, error, count } = await q.order(column, { ascending }).range(offset, offset + pageSize - 1);
  if (error) throw error;
  return {
    pageNo,
    pageSize,
    total: count ?? 0,
    items: (data ?? []).map(tableRow),
  };
}

export async function listAllTables(userId: string): Promise<SemanticTable[]> {
  const { data, error } = await sb
    .from("semantic_tables")
    .select("*")
    .eq("user_id", userId)
    .order("physical_table_name", { ascending: true })
    .range(0, 999);
  if (error) throw error;
  return (data ?? []).map(tableRow);
}

export async function createTable(userId: string, input: SemanticTableInput): Promise<SemanticTable> {
  const { data, error } = await sb
    .from("semantic_tables")
    .insert({
      user_id: userId,
      domain_id: input.domainId,
      datasource_key: input.datasourceKey ?? null,
      schema_name: input.schemaName ?? null,
      physical_table_name: input.physicalTableName,
      physical_description: input.physicalDescription ?? null,
      semantic_name: input.semanticName ?? null,
      semantic_description: input.semanticDescription ?? null,
      is_visible: input.isVisible ?? true,
    })
    .select("*")
    .single();
  if (error) throw error;
  return tableRow(data);
}

export async function updateTable(
  userId: string,
  tableId: string,
  patch: Partial<SemanticTableInput>,
): Promise<SemanticTable> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.domainId !== undefined) payload.domain_id = patch.domainId;
  if (patch.datasourceKey !== undefined) payload.datasource_key = patch.datasourceKey;
  if (patch.schemaName !== undefined) payload.schema_name = patch.schemaName;
  if (patch.physicalTableName !== undefined) payload.physical_table_name = patch.physicalTableName;
  if (patch.physicalDescription !== undefined) payload.physical_description = patch.physicalDescription;
  if (patch.semanticName !== undefined) payload.semantic_name = patch.semanticName;
  if (patch.semanticDescription !== undefined) payload.semantic_description = patch.semanticDescription;
  if (patch.isVisible !== undefined) payload.is_visible = patch.isVisible;
  const { data, error } = await sb
    .from("semantic_tables")
    .update(payload)
    .eq("user_id", userId)
    .eq("id", tableId)
    .select("*")
    .single();
  if (error) throw error;
  return tableRow(data);
}

export async function deleteTable(userId: string, tableId: string): Promise<void> {
  const { error } = await sb.from("semantic_tables").delete().eq("user_id", userId).eq("id", tableId);
  if (error) throw error;
}

export async function batchDeleteTables(userId: string, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const { error, count } = await sb
    .from("semantic_tables")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .in("id", ids);
  if (error) throw error;
  return count ?? 0;
}

export async function getTable(userId: string, tableId: string): Promise<SemanticTable | null> {
  const { data, error } = await sb
    .from("semantic_tables")
    .select("*")
    .eq("user_id", userId)
    .eq("id", tableId)
    .maybeSingle();
  if (error) throw error;
  return data ? tableRow(data) : null;
}

// ---------- Columns ----------

export async function listColumns(
  userId: string,
  query: ColumnListQuery,
): Promise<PagedResult<SemanticColumn>> {
  const { pageNo, pageSize, offset } = normalizePaging(query.pageNo, query.pageSize);
  const sortCol = columnSortMap[query.sortBy ?? "ordinalPosition"] ?? "ordinal_position";
  const { column, ascending } = orderTuple(sortCol, query.sortOrder ?? "asc");

  let q = sb
    .from("semantic_columns")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .eq("table_id", query.tableId);
  q = applyVisibleFilter(q, query.isVisible);
  if (query.keyword && query.keyword.trim()) {
    const kw = escapeIlike(query.keyword.trim());
    q = q.or(
      `physical_column_name.ilike.%${kw}%,semantic_name.ilike.%${kw}%,physical_description.ilike.%${kw}%,semantic_description.ilike.%${kw}%`,
    );
  }
  const { data, error, count } = await q
    .order(column, { ascending, nullsFirst: false })
    .range(offset, offset + pageSize - 1);
  if (error) throw error;
  return {
    pageNo,
    pageSize,
    total: count ?? 0,
    items: (data ?? []).map(columnRow),
  };
}

export async function listAllColumns(userId: string): Promise<SemanticColumn[]> {
  const { data, error } = await sb
    .from("semantic_columns")
    .select("*")
    .eq("user_id", userId)
    .order("table_id", { ascending: true })
    .order("ordinal_position", { ascending: true, nullsFirst: false })
    .range(0, 1999);
  if (error) throw error;
  return (data ?? []).map(columnRow);
}

export async function createColumn(userId: string, input: SemanticColumnInput): Promise<SemanticColumn> {
  const { data, error } = await sb
    .from("semantic_columns")
    .insert({
      user_id: userId,
      table_id: input.tableId,
      physical_column_name: input.physicalColumnName,
      ordinal_position: input.ordinalPosition ?? null,
      data_type: input.dataType ?? null,
      is_nullable: input.isNullable ?? true,
      is_primary_key: input.isPrimaryKey ?? false,
      default_value: input.defaultValue ?? null,
      physical_description: input.physicalDescription ?? null,
      semantic_name: input.semanticName ?? null,
      semantic_description: input.semanticDescription ?? null,
      business_type: input.businessType ?? null,
      example_values: input.exampleValues ?? [],
      is_visible: input.isVisible ?? true,
    })
    .select("*")
    .single();
  if (error) throw error;
  return columnRow(data);
}

export async function updateColumn(
  userId: string,
  columnId: string,
  patch: Partial<SemanticColumnInput>,
): Promise<SemanticColumn> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.physicalColumnName !== undefined) payload.physical_column_name = patch.physicalColumnName;
  if (patch.ordinalPosition !== undefined) payload.ordinal_position = patch.ordinalPosition;
  if (patch.dataType !== undefined) payload.data_type = patch.dataType;
  if (patch.isNullable !== undefined) payload.is_nullable = patch.isNullable;
  if (patch.isPrimaryKey !== undefined) payload.is_primary_key = patch.isPrimaryKey;
  if (patch.defaultValue !== undefined) payload.default_value = patch.defaultValue;
  if (patch.physicalDescription !== undefined) payload.physical_description = patch.physicalDescription;
  if (patch.semanticName !== undefined) payload.semantic_name = patch.semanticName;
  if (patch.semanticDescription !== undefined) payload.semantic_description = patch.semanticDescription;
  if (patch.businessType !== undefined) payload.business_type = patch.businessType;
  if (patch.exampleValues !== undefined) payload.example_values = patch.exampleValues;
  if (patch.isVisible !== undefined) payload.is_visible = patch.isVisible;
  const { data, error } = await sb
    .from("semantic_columns")
    .update(payload)
    .eq("user_id", userId)
    .eq("id", columnId)
    .select("*")
    .single();
  if (error) throw error;
  return columnRow(data);
}

export async function deleteColumn(userId: string, columnId: string): Promise<void> {
  const { error } = await sb.from("semantic_columns").delete().eq("user_id", userId).eq("id", columnId);
  if (error) throw error;
}

export async function batchDeleteColumns(userId: string, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const { error, count } = await sb
    .from("semantic_columns")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .in("id", ids);
  if (error) throw error;
  return count ?? 0;
}

// ---------- Foreign Keys ----------

async function enrichForeignKeysWithNames(userId: string, rows: SemanticForeignKey[]) {
  if (!rows.length) return rows;
  const tableIds = Array.from(new Set(rows.flatMap((r) => [r.sourceTableId, r.targetTableId])));
  const columnIds = Array.from(new Set(rows.flatMap((r) => [r.sourceColumnId, r.targetColumnId])));

  const [tableRes, colRes] = await Promise.all([
    sb.from("semantic_tables").select("id, physical_table_name, semantic_name").eq("user_id", userId).in("id", tableIds),
    sb.from("semantic_columns").select("id, physical_column_name, semantic_name").eq("user_id", userId).in("id", columnIds),
  ]);
  if (tableRes.error) throw tableRes.error;
  if (colRes.error) throw colRes.error;

  const tableMap = new Map<string, string>();
  for (const t of tableRes.data ?? []) {
    tableMap.set(t.id, t.semantic_name || t.physical_table_name);
  }
  const colMap = new Map<string, string>();
  for (const c of colRes.data ?? []) {
    colMap.set(c.id, c.semantic_name || c.physical_column_name);
  }

  return rows.map((r) => ({
    ...r,
    sourceTableName: tableMap.get(r.sourceTableId) ?? null,
    sourceColumnName: colMap.get(r.sourceColumnId) ?? null,
    targetTableName: tableMap.get(r.targetTableId) ?? null,
    targetColumnName: colMap.get(r.targetColumnId) ?? null,
  }));
}

export async function listForeignKeys(
  userId: string,
  query: ForeignKeyListQuery = {},
): Promise<PagedResult<SemanticForeignKey>> {
  const { pageNo, pageSize, offset } = normalizePaging(query.pageNo, query.pageSize);
  const sortCol = fkSortMap[query.sortBy ?? "updatedAt"] ?? "updated_at";
  const { column, ascending } = orderTuple(sortCol, query.sortOrder ?? "desc");

  let q = sb.from("semantic_logical_foreign_keys").select("*", { count: "exact" }).eq("user_id", userId);
  q = applyVisibleFilter(q, query.isVisible);
  if (query.keyword && query.keyword.trim()) {
    const kw = escapeIlike(query.keyword.trim());
    q = q.or(`physical_description.ilike.%${kw}%,semantic_description.ilike.%${kw}%`);
  }
  const { data, error, count } = await q.order(column, { ascending }).range(offset, offset + pageSize - 1);
  if (error) throw error;

  const rows = (data ?? []).map(fkRow);
  const enriched = await enrichForeignKeysWithNames(userId, rows);
  return {
    pageNo,
    pageSize,
    total: count ?? 0,
    items: enriched,
  };
}

export async function createForeignKey(
  userId: string,
  input: SemanticForeignKeyInput,
): Promise<SemanticForeignKey> {
  const { data, error } = await sb
    .from("semantic_logical_foreign_keys")
    .insert({
      user_id: userId,
      source_table_id: input.sourceTableId,
      source_column_id: input.sourceColumnId,
      target_table_id: input.targetTableId,
      target_column_id: input.targetColumnId,
      relation_type: input.relationType,
      source_type: input.sourceType ?? "manual",
      confidence: input.confidence ?? 1,
      physical_description: input.physicalDescription ?? null,
      semantic_description: input.semanticDescription ?? null,
      is_visible: input.isVisible ?? true,
    })
    .select("*")
    .single();
  if (error) throw error;
  return fkRow(data);
}

export async function updateForeignKey(
  userId: string,
  fkId: string,
  patch: Partial<SemanticForeignKeyInput>,
): Promise<SemanticForeignKey> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.sourceTableId !== undefined) payload.source_table_id = patch.sourceTableId;
  if (patch.sourceColumnId !== undefined) payload.source_column_id = patch.sourceColumnId;
  if (patch.targetTableId !== undefined) payload.target_table_id = patch.targetTableId;
  if (patch.targetColumnId !== undefined) payload.target_column_id = patch.targetColumnId;
  if (patch.relationType !== undefined) payload.relation_type = patch.relationType;
  if (patch.sourceType !== undefined) payload.source_type = patch.sourceType;
  if (patch.confidence !== undefined) payload.confidence = patch.confidence;
  if (patch.physicalDescription !== undefined) payload.physical_description = patch.physicalDescription;
  if (patch.semanticDescription !== undefined) payload.semantic_description = patch.semanticDescription;
  if (patch.isVisible !== undefined) payload.is_visible = patch.isVisible;
  const { data, error } = await sb
    .from("semantic_logical_foreign_keys")
    .update(payload)
    .eq("user_id", userId)
    .eq("id", fkId)
    .select("*")
    .single();
  if (error) throw error;
  return fkRow(data);
}

export async function deleteForeignKey(userId: string, fkId: string): Promise<void> {
  const { error } = await sb
    .from("semantic_logical_foreign_keys")
    .delete()
    .eq("user_id", userId)
    .eq("id", fkId);
  if (error) throw error;
}

export async function batchDeleteForeignKeys(userId: string, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const { error, count } = await sb
    .from("semantic_logical_foreign_keys")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .in("id", ids);
  if (error) throw error;
  return count ?? 0;
}

// ---------- Sync ----------

const emptyCounter = (): SyncCounter => ({ created: 0, updated: 0, missing: 0, skipped: 0 });

/**
 * Upsert a full datasource-to-domain tree.
 * - Domain: match by (user_id, name) — creates if missing, updates description/isVisible if present.
 * - Tables: match by (user_id, domain_id, datasource_key, physical_table_name).
 *   For tables belonging to the same (domain_id, datasource_key) scope that exist in DB but are
 *   NOT in the incoming payload, when markMissing is true, flip sync_status to 'missing'.
 *   Incoming previously-missing rows flip back to 'active'.
 * - Columns: per table, same missing-marking policy scoped to that table.
 */
export async function syncSemanticLayer(userId: string, payload: SyncPayload): Promise<SyncResult> {
  const result: SyncResult = {
    domain: emptyCounter(),
    tables: emptyCounter(),
    columns: emptyCounter(),
    foreignKeys: emptyCounter(),
    syncedAt: new Date().toISOString(),
  };

  // ---- 1. Domain upsert ----
  const { data: existingDomainRows, error: domainErr } = await sb
    .from("semantic_domains")
    .select("*")
    .eq("user_id", userId)
    .eq("name", payload.domain.name)
    .limit(1);
  if (domainErr) throw domainErr;
  let domainId: string;
  const existingDomain = existingDomainRows?.[0];
  if (existingDomain) {
    const { data: updated, error } = await sb
      .from("semantic_domains")
      .update({
        description: payload.domain.description ?? existingDomain.description,
        is_visible: payload.domain.isVisible ?? existingDomain.is_visible,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("id", existingDomain.id)
      .select("id")
      .single();
    if (error) throw error;
    domainId = updated.id;
    result.domain.updated += 1;
  } else {
    const { data: inserted, error } = await sb
      .from("semantic_domains")
      .insert({
        user_id: userId,
        name: payload.domain.name,
        description: payload.domain.description ?? null,
        is_visible: payload.domain.isVisible ?? true,
      })
      .select("id")
      .single();
    if (error) throw error;
    domainId = inserted.id;
    result.domain.created += 1;
  }

  // ---- 2. Existing tables in this (domain, datasourceKey) scope ----
  const { data: existingTables, error: tblErr } = await sb
    .from("semantic_tables")
    .select("*")
    .eq("user_id", userId)
    .eq("domain_id", domainId)
    .eq("datasource_key", payload.datasourceKey);
  if (tblErr) throw tblErr;

  const existingTableByName = new Map<string, any>();
  for (const t of existingTables ?? []) {
    existingTableByName.set(t.physical_table_name, t);
  }

  const incomingTableNames = new Set(payload.tables.map((t) => t.physicalTableName));
  const nowIso = new Date().toISOString();

  // 2a. Upsert incoming tables
  const tableIdByName = new Map<string, string>();
  for (const inTbl of payload.tables) {
    const existing = existingTableByName.get(inTbl.physicalTableName);
    if (existing) {
      const nextStatus = existing.sync_status === "missing" ? "active" : existing.sync_status;
      const { error } = await sb
        .from("semantic_tables")
        .update({
          physical_description: inTbl.physicalDescription ?? existing.physical_description,
          semantic_name: inTbl.semanticName ?? existing.semantic_name,
          semantic_description: inTbl.semanticDescription ?? existing.semantic_description,
          is_visible: inTbl.isVisible ?? existing.is_visible,
          schema_name: payload.schemaName ?? existing.schema_name,
          sync_status: nextStatus,
          updated_at: nowIso,
        })
        .eq("user_id", userId)
        .eq("id", existing.id);
      if (error) throw error;
      tableIdByName.set(inTbl.physicalTableName, existing.id);
      result.tables.updated += 1;
    } else {
      const { data: inserted, error } = await sb
        .from("semantic_tables")
        .insert({
          user_id: userId,
          domain_id: domainId,
          datasource_key: payload.datasourceKey,
          schema_name: payload.schemaName ?? null,
          physical_table_name: inTbl.physicalTableName,
          physical_description: inTbl.physicalDescription ?? null,
          semantic_name: inTbl.semanticName ?? null,
          semantic_description: inTbl.semanticDescription ?? null,
          is_visible: inTbl.isVisible ?? true,
          sync_status: "active",
        })
        .select("id")
        .single();
      if (error) throw error;
      tableIdByName.set(inTbl.physicalTableName, inserted.id);
      result.tables.created += 1;
    }
  }

  // 2b. Soft-mark missing tables
  const markMissing = payload.markMissing !== false;
  if (markMissing) {
    for (const existing of existingTables ?? []) {
      if (!incomingTableNames.has(existing.physical_table_name)) {
        if (existing.sync_status !== "missing") {
          const { error } = await sb
            .from("semantic_tables")
            .update({ sync_status: "missing", updated_at: nowIso })
            .eq("user_id", userId)
            .eq("id", existing.id);
          if (error) throw error;
          result.tables.missing += 1;
        } else {
          result.tables.skipped += 1;
        }
      }
    }
  }

  // ---- 3. Columns per table ----
  for (const inTbl of payload.tables) {
    const tableId = tableIdByName.get(inTbl.physicalTableName);
    if (!tableId) continue;
    const { data: existingCols, error: colErr } = await sb
      .from("semantic_columns")
      .select("*")
      .eq("user_id", userId)
      .eq("table_id", tableId);
    if (colErr) throw colErr;

    const existingColByName = new Map<string, any>();
    for (const c of existingCols ?? []) existingColByName.set(c.physical_column_name, c);

    const incomingColNames = new Set(inTbl.columns.map((c) => c.physicalColumnName));

    for (const inCol of inTbl.columns) {
      const existing = existingColByName.get(inCol.physicalColumnName);
      if (existing) {
        const nextStatus = existing.sync_status === "missing" ? "active" : existing.sync_status;
        const { error } = await sb
          .from("semantic_columns")
          .update({
            ordinal_position: inCol.ordinalPosition ?? existing.ordinal_position,
            data_type: inCol.dataType ?? existing.data_type,
            is_nullable: inCol.isNullable ?? existing.is_nullable,
            is_primary_key: inCol.isPrimaryKey ?? existing.is_primary_key,
            default_value: inCol.defaultValue ?? existing.default_value,
            physical_description: inCol.physicalDescription ?? existing.physical_description,
            semantic_name: inCol.semanticName ?? existing.semantic_name,
            semantic_description: inCol.semanticDescription ?? existing.semantic_description,
            business_type: inCol.businessType ?? existing.business_type,
            example_values: inCol.exampleValues ?? existing.example_values,
            is_visible: inCol.isVisible ?? existing.is_visible,
            sync_status: nextStatus,
            updated_at: nowIso,
          })
          .eq("user_id", userId)
          .eq("id", existing.id);
        if (error) throw error;
        result.columns.updated += 1;
      } else {
        const { error } = await sb.from("semantic_columns").insert({
          user_id: userId,
          table_id: tableId,
          physical_column_name: inCol.physicalColumnName,
          ordinal_position: inCol.ordinalPosition ?? null,
          data_type: inCol.dataType ?? null,
          is_nullable: inCol.isNullable ?? true,
          is_primary_key: inCol.isPrimaryKey ?? false,
          default_value: inCol.defaultValue ?? null,
          physical_description: inCol.physicalDescription ?? null,
          semantic_name: inCol.semanticName ?? null,
          semantic_description: inCol.semanticDescription ?? null,
          business_type: inCol.businessType ?? null,
          example_values: inCol.exampleValues ?? [],
          is_visible: inCol.isVisible ?? true,
          sync_status: "active",
        });
        if (error) throw error;
        result.columns.created += 1;
      }
    }

    if (markMissing) {
      for (const existing of existingCols ?? []) {
        if (!incomingColNames.has(existing.physical_column_name)) {
          if (existing.sync_status !== "missing") {
            const { error } = await sb
              .from("semantic_columns")
              .update({ sync_status: "missing", updated_at: nowIso })
              .eq("user_id", userId)
              .eq("id", existing.id);
            if (error) throw error;
            result.columns.missing += 1;
          } else {
            result.columns.skipped += 1;
          }
        }
      }
    }
  }

  return result;
}
