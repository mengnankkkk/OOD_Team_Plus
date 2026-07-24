import { useEffect, useSyncExternalStore } from "react";

import type { SemanticColumn, SemanticDomain, SemanticForeignKey, SemanticTable } from "@/types/app/semantic";
import {
  createColumn, createDomain, createForeignKey, createTable,
  deleteColumns, deleteDomains, deleteForeignKeys, deleteTables,
  listColumns, listDomains, listForeignKeys, listTables,
  updateColumn, updateDomain, updateForeignKey, updateTable,
} from "@/services/semanticService";

type Topic = "domains" | "tables" | "columns" | "fks" | "status";
type LoadStatus = { loading: boolean; loaded: boolean; error: string };

const state = {
  domains: [] as SemanticDomain[],
  tables: [] as SemanticTable[],
  columns: [] as SemanticColumn[],
  fks: [] as SemanticForeignKey[],
  status: { loading: false, loaded: false, error: "" } as LoadStatus,
};

const listeners: Record<Topic, Set<() => void>> = {
  domains: new Set(), tables: new Set(), columns: new Set(), fks: new Set(), status: new Set(),
};
const notify = (topic: Topic) => listeners[topic].forEach((listener) => listener());
const notifyAll = () => (Object.keys(listeners) as Topic[]).forEach(notify);
const subscribe = (topic: Topic) => (listener: () => void) => {
  listeners[topic].add(listener);
  return () => listeners[topic].delete(listener);
};

let loadPromise: Promise<void> | null = null;

export function reloadSemanticLayer() {
  if (loadPromise) return loadPromise;
  state.status = { ...state.status, loading: true, error: "" };
  notify("status");
  loadPromise = Promise.all([listDomains(), listTables(), listColumns(), listForeignKeys()])
    .then(([domains, tables, columns, fks]) => {
      state.domains = domains;
      state.tables = tables;
      state.columns = columns;
      state.fks = fks;
      state.status = { loading: false, loaded: true, error: "" };
      notifyAll();
    })
    .catch((reason: unknown) => {
      state.status = { loading: false, loaded: false, error: reason instanceof Error ? reason.message : "语义层加载失败" };
      notify("status");
    })
    .finally(() => { loadPromise = null; });
  return loadPromise;
}

function useSnapshot<T>(topic: Topic, getSnapshot: () => T) {
  useEffect(() => { if (!state.status.loaded && !state.status.loading) void reloadSemanticLayer(); }, []);
  return useSyncExternalStore(subscribe(topic), getSnapshot, getSnapshot);
}

export const useSemanticStatus = () => useSnapshot("status", () => state.status);
export const useDomains = () => useSnapshot("domains", () => state.domains);
export const useTables = () => useSnapshot("tables", () => state.tables);
export const useColumns = () => useSnapshot("columns", () => state.columns);
export const useForeignKeys = () => useSnapshot("fks", () => state.fks);
export const getDomains = () => state.domains;
export const getTables = () => state.tables;
export const getColumns = () => state.columns;
export const getForeignKeys = () => state.fks;

const changed = <T,>(left: T, right: T) => JSON.stringify(left) !== JSON.stringify(right);

async function persist<T>(operation: () => Promise<T>) {
  state.status = { ...state.status, error: "" };
  notify("status");
  try { await operation(); await reloadSemanticLayer(); }
  catch (reason) {
    state.status = { ...state.status, error: reason instanceof Error ? reason.message : "语义层保存失败" };
    notify("status");
    await reloadSemanticLayer();
  }
}

export const setDomains = (next: SemanticDomain[]) => {
  const previous = state.domains; state.domains = next; notify("domains");
  void persist(async () => {
    const before = new Map(previous.map((item) => [item.id, item]));
    const after = new Map(next.map((item) => [item.id, item]));
    const removed = previous.filter((item) => !after.has(item.id)).map((item) => item.id);
    if (removed.length) await deleteDomains(removed);
    for (const item of next) { const old = before.get(item.id); if (!old) await createDomain(item); else if (changed(old, item)) await updateDomain(item.id, item); }
  });
};

export const setTables = (next: SemanticTable[]) => {
  const previous = state.tables; state.tables = next; notify("tables");
  void persist(async () => {
    const before = new Map(previous.map((item) => [item.id, item]));
    const after = new Map(next.map((item) => [item.id, item]));
    const removed = previous.filter((item) => !after.has(item.id)).map((item) => item.id);
    if (removed.length) await deleteTables(removed);
    for (const item of next) { const old = before.get(item.id); if (!old) await createTable(item); else if (changed(old, item)) await updateTable(item.id, item); }
  });
};

export const setColumns = (next: SemanticColumn[]) => {
  const previous = state.columns; state.columns = next; notify("columns");
  void persist(async () => {
    const before = new Map(previous.map((item) => [item.id, item]));
    const after = new Map(next.map((item) => [item.id, item]));
    const removed = previous.filter((item) => !after.has(item.id)).map((item) => item.id);
    if (removed.length) await deleteColumns(removed);
    for (const item of next) { const old = before.get(item.id); if (!old) await createColumn(item.tableId, item); else if (changed(old, item)) await updateColumn(item.id, item); }
  });
};

export const setForeignKeys = (next: SemanticForeignKey[]) => {
  const previous = state.fks; state.fks = next; notify("fks");
  void persist(async () => {
    const before = new Map(previous.map((item) => [item.id, item]));
    const after = new Map(next.map((item) => [item.id, item]));
    const removed = previous.filter((item) => !after.has(item.id)).map((item) => item.id);
    if (removed.length) await deleteForeignKeys(removed);
    for (const item of next) { const old = before.get(item.id); if (!old) await createForeignKey(item); else if (changed(old, item)) await updateForeignKey(item.id, item); }
  });
};
