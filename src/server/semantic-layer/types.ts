import type { ResultSet } from "@libsql/client";

type Row = ResultSet["rows"][number];

function text(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

function numberValue(row: Row, key: string) {
  const value = row[key];
  return typeof value === "number" ? value : 0;
}

function bool(row: Row, key: string) {
  return Boolean(numberValue(row, key));
}

export function countFrom(result: ResultSet) {
  const value = result.rows[0]?.total;
  return typeof value === "number" ? value : 0;
}

export function jsonArray(row: Row, key: string) {
  const value = text(row, key);
  return value ? (JSON.parse(value) as string[]) : undefined;
}

export function domainFrom(row: Row) {
  return {
    id: text(row, "id") ?? "",
    name: text(row, "name") ?? "",
    description: text(row, "description"),
    isVisible: bool(row, "is_visible"),
    createdAt: text(row, "created_at") ?? "",
    updatedAt: text(row, "updated_at") ?? "",
  };
}

export function tableFrom(row: Row) {
  return {
    id: text(row, "id") ?? "",
    domainId: text(row, "domain_id") ?? "",
    schemaName: text(row, "schema_name"),
    physicalTableName: text(row, "physical_table_name") ?? "",
    physicalDescription: text(row, "physical_description"),
    semanticName: text(row, "semantic_name"),
    semanticDescription: text(row, "semantic_description"),
    isVisible: bool(row, "is_visible"),
    syncStatus: text(row, "sync_status") ?? "active",
    createdAt: text(row, "created_at") ?? "",
    updatedAt: text(row, "updated_at") ?? "",
  };
}

export function columnFrom(row: Row) {
  return {
    id: text(row, "id") ?? "",
    tableId: text(row, "table_id") ?? "",
    physicalColumnName: text(row, "physical_column_name") ?? "",
    ordinalPosition: numberValue(row, "ordinal_position"),
    dataType: text(row, "data_type") ?? "",
    isNullable: bool(row, "is_nullable"),
    isPrimaryKey: bool(row, "is_primary_key"),
    defaultValue: text(row, "default_value"),
    physicalDescription: text(row, "physical_description"),
    semanticName: text(row, "semantic_name"),
    semanticDescription: text(row, "semantic_description"),
    businessType: text(row, "business_type"),
    exampleValues: jsonArray(row, "example_values"),
    isVisible: bool(row, "is_visible"),
    syncStatus: text(row, "sync_status") ?? "active",
    createdAt: text(row, "created_at") ?? "",
    updatedAt: text(row, "updated_at") ?? "",
  };
}

export function foreignKeyFrom(row: Row) {
  return {
    id: text(row, "id") ?? "",
    sourceTableId: text(row, "source_table_id") ?? "",
    sourceColumnId: text(row, "source_column_id") ?? "",
    targetTableId: text(row, "target_table_id") ?? "",
    targetColumnId: text(row, "target_column_id") ?? "",
    sourceTableName: text(row, "source_table_name"),
    sourceColumnName: text(row, "source_column_name"),
    targetTableName: text(row, "target_table_name"),
    targetColumnName: text(row, "target_column_name"),
    relationType: text(row, "relation_type") ?? "many_to_one",
    sourceType: text(row, "source_type") ?? "manual",
    confidence: numberValue(row, "confidence"),
    physicalDescription: text(row, "physical_description"),
    semanticDescription: text(row, "semantic_description"),
    isVisible: bool(row, "is_visible"),
    createdAt: text(row, "created_at") ?? "",
    updatedAt: text(row, "updated_at") ?? "",
  };
}
