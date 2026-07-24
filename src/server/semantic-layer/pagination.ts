import type { PageQuery } from "@/server/semantic-layer/contract";

export type SortMapper = Record<PageQuery["sortBy"], string>;

export type PageResult<T> = {
  pageNo: number;
  pageSize: number;
  total: number;
  items: T[];
};

export const domainSortMapper: SortMapper = {
  updatedAt: "updated_at",
  createdAt: "created_at",
  name: "name",
};

export const tableSortMapper: SortMapper = {
  updatedAt: "t.updated_at",
  createdAt: "t.created_at",
  name: "coalesce(t.semantic_name, t.physical_table_name)",
};

export const columnSortMapper: SortMapper = {
  updatedAt: "updated_at",
  createdAt: "created_at",
  name: "coalesce(semantic_name, physical_column_name)",
};

export const foreignKeySortMapper: SortMapper = {
  updatedAt: "fk.updated_at",
  createdAt: "fk.created_at",
  name: "source_column.physical_column_name",
};

export function pageArgs(query: PageQuery) {
  return {
    limit: query.pageSize,
    offset: (query.pageNo - 1) * query.pageSize,
  };
}

export function orderBy(query: PageQuery, mapper: SortMapper) {
  const field = mapper[query.sortBy] ?? mapper.updatedAt;
  const direction = query.sortOrder === "asc" ? "asc" : "desc";
  return `${field} ${direction}`;
}

export function likeKeyword(keyword: string | undefined) {
  return keyword ? `%${keyword}%` : null;
}

export function pageResult<T>(
  query: PageQuery,
  total: number,
  items: T[],
): PageResult<T> {
  return {
    pageNo: query.pageNo,
    pageSize: query.pageSize,
    total,
    items,
  };
}
