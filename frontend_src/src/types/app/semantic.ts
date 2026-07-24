export interface SemanticDomain {
  id: string;
  name: string;
  description: string | null;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SemanticTable {
  id: string;
  domainId: string;
  datasourceKey?: string | null;
  schemaName: string | null;
  physicalTableName: string;
  physicalDescription: string | null;
  semanticName: string | null;
  semanticDescription: string | null;
  isVisible: boolean;
  syncStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface SemanticColumn {
  id: string;
  tableId: string;
  physicalColumnName: string;
  ordinalPosition: number | null;
  dataType: string | null;
  isNullable: boolean;
  isPrimaryKey: boolean;
  defaultValue: string | null;
  physicalDescription: string | null;
  semanticName: string | null;
  semanticDescription: string | null;
  businessType: string | null;
  exampleValues: string[];
  isVisible: boolean;
  syncStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface SemanticForeignKey {
  id: string;
  sourceTableId: string;
  sourceColumnId: string;
  targetTableId: string;
  targetColumnId: string;
  sourceTableName?: string | null;
  sourceColumnName?: string | null;
  targetTableName?: string | null;
  targetColumnName?: string | null;
  relationType: string;
  sourceType: string;
  confidence: number;
  physicalDescription: string | null;
  semanticDescription: string | null;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SemanticDomainInput {
  name: string;
  description?: string | null;
  isVisible?: boolean;
}

export interface SemanticTableInput {
  domainId: string;
  datasourceKey?: string | null;
  schemaName?: string | null;
  physicalTableName: string;
  physicalDescription?: string | null;
  semanticName?: string | null;
  semanticDescription?: string | null;
  isVisible?: boolean;
}

export interface SemanticColumnInput {
  tableId: string;
  physicalColumnName: string;
  ordinalPosition?: number | null;
  dataType?: string | null;
  isNullable?: boolean;
  isPrimaryKey?: boolean;
  defaultValue?: string | null;
  physicalDescription?: string | null;
  semanticName?: string | null;
  semanticDescription?: string | null;
  businessType?: string | null;
  exampleValues?: string[];
  isVisible?: boolean;
}

export interface SemanticForeignKeyInput {
  sourceTableId: string;
  sourceColumnId: string;
  targetTableId: string;
  targetColumnId: string;
  relationType: string;
  sourceType?: string;
  confidence?: number;
  physicalDescription?: string | null;
  semanticDescription?: string | null;
  isVisible?: boolean;
}

// --- Paged envelope & query params (aligned to REST contract) ---

export type SortOrder = "asc" | "desc";

export type IsVisibleFilter = "all" | "visible" | "hidden";

export interface PagedResult<T> {
  pageNo: number;
  pageSize: number;
  total: number;
  items: T[];
}

export interface BaseListQuery {
  pageNo?: number;
  pageSize?: number;
  keyword?: string;
  isVisible?: IsVisibleFilter;
  sortOrder?: SortOrder;
}

export type DomainSortField = "updatedAt" | "createdAt" | "name";
export interface DomainListQuery extends BaseListQuery {
  sortBy?: DomainSortField;
}

export type TableSortField =
  | "updatedAt"
  | "createdAt"
  | "physicalTableName"
  | "semanticName";
export interface TableListQuery extends BaseListQuery {
  sortBy?: TableSortField;
  domainId?: string | null;
}

export type ColumnSortField =
  | "ordinalPosition"
  | "updatedAt"
  | "createdAt"
  | "physicalColumnName"
  | "semanticName";
export interface ColumnListQuery extends BaseListQuery {
  sortBy?: ColumnSortField;
  tableId: string;
}

export type ForeignKeySortField = "updatedAt" | "createdAt" | "confidence";
export interface ForeignKeyListQuery extends BaseListQuery {
  sortBy?: ForeignKeySortField;
}

// --- Sync payload / result ---

export interface SyncColumnInput {
  physicalColumnName: string;
  ordinalPosition?: number | null;
  dataType?: string | null;
  isNullable?: boolean;
  isPrimaryKey?: boolean;
  defaultValue?: string | null;
  physicalDescription?: string | null;
  semanticName?: string | null;
  semanticDescription?: string | null;
  businessType?: string | null;
  exampleValues?: string[];
  isVisible?: boolean;
}

export interface SyncTableInput {
  physicalTableName: string;
  physicalDescription?: string | null;
  semanticName?: string | null;
  semanticDescription?: string | null;
  isVisible?: boolean;
  columns: SyncColumnInput[];
}

export interface SyncPayload {
  datasourceKey: string;
  schemaName?: string | null;
  domain: {
    name: string;
    description?: string | null;
    isVisible?: boolean;
  };
  tables: SyncTableInput[];
  foreignKeys?: {
    sourcePhysicalTableName: string;
    sourcePhysicalColumnName: string;
    targetPhysicalTableName: string;
    targetPhysicalColumnName: string;
    relationType?: string;
    confidence?: number;
    physicalDescription?: string | null;
    semanticDescription?: string | null;
    isVisible?: boolean;
  }[];
  markMissing?: boolean;
}

export interface SyncCounter {
  created: number;
  updated: number;
  missing: number;
  skipped: number;
}

export interface SyncResult {
  domain: SyncCounter;
  tables: SyncCounter;
  columns: SyncCounter;
  foreignKeys: SyncCounter;
  syncedAt: string;
}
