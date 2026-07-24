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
  SyncTableInput,
} from "@/types/app/semantic";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
const SEMANTIC_API = "/api/v1/admin/semantic-layer";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (init?.method && init.method !== "GET") {
    headers.set("Idempotency-Key", crypto.randomUUID());
    const csrf = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("mw_csrf="))?.slice("mw_csrf=".length);
    if (csrf) headers.set("X-CSRF-Token", decodeURIComponent(csrf));
  }
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
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

export const listDomains = () => listAll<SemanticDomain>(`${SEMANTIC_API}/domains`);
export const listTables = () => listAll<SemanticTable>(`${SEMANTIC_API}/tables`);
export const listColumns = () => listAll<SemanticColumn>(`${SEMANTIC_API}/columns`);
export const listForeignKeys = () => listAll<SemanticForeignKey>(`${SEMANTIC_API}/logical-foreign-keys`);

export type SemanticDatasource = { key: string; label: string; description: string; schemaName: string; tables: SyncTableInput[] };
export const listSemanticDatasources = () => api<{ items: SemanticDatasource[] }>(`${SEMANTIC_API}/datasources`);

export function createDomain(input: SemanticDomainInput) {
  return api<SemanticDomain>(`${SEMANTIC_API}/domains`, {
    method: "POST",
    body: body(input),
  });
}

export function updateDomain(id: string, input: Partial<SemanticDomainInput>) {
  return api<SemanticDomain>(`${SEMANTIC_API}/domains/${id}`, {
    method: "PATCH",
    body: body(input),
  });
}

export function deleteDomains(ids: string[]) {
  if (ids.length === 1) {
    return api<{ deleted: number }>(`${SEMANTIC_API}/domains/${ids[0]}`, { method: "DELETE" });
  }
  return api<{ deleted: number }>(`${SEMANTIC_API}/domains/batch-delete`, {
    method: "POST",
    body: body({ ids }),
  });
}

export function createTable(input: SemanticTableInput) {
  return api<SemanticTable>(`${SEMANTIC_API}/tables`, {
    method: "POST",
    body: body({
      ...input,
      datasourceKey: input.datasourceKey || "main",
    }),
  });
}

export function updateTable(id: string, input: Partial<SemanticTableInput>) {
  return api<SemanticTable>(`${SEMANTIC_API}/tables/${id}`, {
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
    return api<{ deleted: number }>(`${SEMANTIC_API}/tables/${ids[0]}`, { method: "DELETE" });
  }
  return api<{ deleted: number }>(`${SEMANTIC_API}/tables/batch-delete`, {
    method: "POST",
    body: body({ ids }),
  });
}

export function createColumn(tableId: string, input: SemanticColumnInput) {
  return api<SemanticColumn>(`${SEMANTIC_API}/tables/${tableId}/columns`, {
    method: "POST",
    body: body({
      ...input,
      ordinalPosition: input.ordinalPosition ?? 1,
      dataType: input.dataType || "text",
    }),
  });
}

export function updateColumn(id: string, input: Partial<SemanticColumnInput>) {
  return api<SemanticColumn>(`${SEMANTIC_API}/columns/${id}`, {
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
    return api<{ deleted: number }>(`${SEMANTIC_API}/columns/${ids[0]}`, { method: "DELETE" });
  }
  return api<{ deleted: number }>(`${SEMANTIC_API}/columns/batch-delete`, {
    method: "POST",
    body: body({ ids }),
  });
}

export function createForeignKey(input: SemanticForeignKeyInput) {
  return api<SemanticForeignKey>(`${SEMANTIC_API}/logical-foreign-keys`, {
    method: "POST",
    body: body(input),
  });
}

export function updateForeignKey(id: string, input: Partial<SemanticForeignKeyInput>) {
  return api<SemanticForeignKey>(`${SEMANTIC_API}/logical-foreign-keys/${id}`, {
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
    return api<{ deleted: number }>(`${SEMANTIC_API}/logical-foreign-keys/${ids[0]}`, { method: "DELETE" });
  }
  return api<{ deleted: number }>(`${SEMANTIC_API}/logical-foreign-keys/batch-delete`, {
    method: "POST",
    body: body({ ids }),
  });
}

export function syncSemanticLayer(payload: SyncPayload) {
  return api<SyncResult>(`${SEMANTIC_API}/sync`, {
    method: "POST",
    body: body(payload),
  });
}
