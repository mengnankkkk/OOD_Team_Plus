import type {
  PagedResult,
  SemanticColumn,
  SemanticColumnInput,
  SemanticDomain,
  SemanticDomainInput,
  SemanticForeignKey,
  SemanticForeignKeyInput,
  SemanticTable,
  SemanticTableInput,
  SyncPayload,
  SyncResult,
} from "@/types/app/semantic";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Semantic layer request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function listAll<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let pageNo = 1;
  while (true) {
    const sep = path.includes("?") ? "&" : "?";
    const page = await api<PagedResult<T>>(`${path}${sep}pageNo=${pageNo}&pageSize=100`);
    items.push(...page.items);
    if (items.length >= page.total || page.items.length === 0) return items;
    pageNo += 1;
  }
}

const body = (value: unknown) => JSON.stringify(value);

export const listDomains = () => listAll<SemanticDomain>("/api/semantic-layer/domains");
export const listTables = () => listAll<SemanticTable>("/api/semantic-layer/tables");
export const listColumns = () => listAll<SemanticColumn>("/api/semantic-layer/columns");
export const listForeignKeys = () => listAll<SemanticForeignKey>("/api/semantic-layer/logical-foreign-keys");

export function createDomain(input: SemanticDomainInput) {
  return api<SemanticDomain>("/api/semantic-layer/domains", {
    method: "POST",
    body: body(input),
  });
}

export function updateDomain(id: string, input: Partial<SemanticDomainInput>) {
  return api<SemanticDomain>(`/api/semantic-layer/domains/${id}`, {
    method: "PATCH",
    body: body(input),
  });
}

export function deleteDomains(ids: string[]) {
  if (ids.length === 1) {
    return api<{ deleted: number }>(`/api/semantic-layer/domains/${ids[0]}`, { method: "DELETE" });
  }
  return api<{ deleted: number }>("/api/semantic-layer/domains/batch-delete", {
    method: "POST",
    body: body({ ids }),
  });
}

export function createTable(input: SemanticTableInput) {
  return api<SemanticTable>("/api/semantic-layer/tables", {
    method: "POST",
    body: body({
      ...input,
      datasourceKey: input.datasourceKey || "main",
    }),
  });
}

export function updateTable(id: string, input: Partial<SemanticTableInput>) {
  return api<SemanticTable>(`/api/semantic-layer/tables/${id}`, {
    method: "PATCH",
    body: body({
      semanticName: input.semanticName,
      semanticDescription: input.semanticDescription,
      isVisible: input.isVisible,
    }),
  });
}

export function deleteTables(ids: string[]) {
  if (ids.length === 1) {
    return api<{ deleted: number }>(`/api/semantic-layer/tables/${ids[0]}`, { method: "DELETE" });
  }
  return api<{ deleted: number }>("/api/semantic-layer/tables/batch-delete", {
    method: "POST",
    body: body({ ids }),
  });
}

export function createColumn(tableId: string, input: SemanticColumnInput) {
  return api<SemanticColumn>(`/api/semantic-layer/tables/${tableId}/columns`, {
    method: "POST",
    body: body({
      ...input,
      ordinalPosition: input.ordinalPosition ?? 1,
      dataType: input.dataType || "text",
    }),
  });
}

export function updateColumn(id: string, input: Partial<SemanticColumnInput>) {
  return api<SemanticColumn>(`/api/semantic-layer/columns/${id}`, {
    method: "PATCH",
    body: body({
      semanticName: input.semanticName,
      semanticDescription: input.semanticDescription,
      businessType: input.businessType,
      exampleValues: input.exampleValues,
      isVisible: input.isVisible,
    }),
  });
}

export function deleteColumns(ids: string[]) {
  if (ids.length === 1) {
    return api<{ deleted: number }>(`/api/semantic-layer/columns/${ids[0]}`, { method: "DELETE" });
  }
  return api<{ deleted: number }>("/api/semantic-layer/columns/batch-delete", {
    method: "POST",
    body: body({ ids }),
  });
}

export function createForeignKey(input: SemanticForeignKeyInput) {
  return api<SemanticForeignKey>("/api/semantic-layer/logical-foreign-keys", {
    method: "POST",
    body: body(input),
  });
}

export function updateForeignKey(id: string, input: Partial<SemanticForeignKeyInput>) {
  return api<SemanticForeignKey>(`/api/semantic-layer/logical-foreign-keys/${id}`, {
    method: "PATCH",
    body: body({
      relationType: input.relationType,
      confidence: input.confidence,
      physicalDescription: input.physicalDescription,
      semanticDescription: input.semanticDescription,
      isVisible: input.isVisible,
    }),
  });
}

export function deleteForeignKeys(ids: string[]) {
  if (ids.length === 1) {
    return api<{ deleted: number }>(`/api/semantic-layer/logical-foreign-keys/${ids[0]}`, { method: "DELETE" });
  }
  return api<{ deleted: number }>("/api/semantic-layer/logical-foreign-keys/batch-delete", {
    method: "POST",
    body: body({ ids }),
  });
}

export function syncSemanticLayer(payload: SyncPayload) {
  return api<SyncResult>("/api/semantic-layer/sync", {
    method: "POST",
    body: body(payload),
  });
}
