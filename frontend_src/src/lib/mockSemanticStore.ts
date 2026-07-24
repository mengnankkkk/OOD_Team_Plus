// Shared in-memory store powering all 4 semantic layer pages.
// Uses React 18's useSyncExternalStore so any page seeing the store is
// automatically re-rendered when another page mutates it.

import { useEffect, useSyncExternalStore } from "react";
import type {
  SemanticColumn,
  SemanticDomain,
  SemanticForeignKey,
  SemanticTable,
} from "@/types/app/semantic";
import { MOCK_COLUMNS, MOCK_DOMAINS, MOCK_FOREIGN_KEYS, MOCK_TABLES } from "@/lib/mockSemanticData";
import {
  createColumn,
  createDomain,
  createForeignKey,
  createTable,
  deleteColumns,
  deleteDomains,
  deleteForeignKeys,
  deleteTables,
  listColumns,
  listDomains,
  listForeignKeys,
  listTables,
  updateColumn,
  updateDomain,
  updateForeignKey,
  updateTable,
} from "@/services/semanticService";

type Topic = "domains" | "tables" | "columns" | "fks";

const state = {
  domains: [...MOCK_DOMAINS] as SemanticDomain[],
  tables: [...MOCK_TABLES] as SemanticTable[],
  columns: [...MOCK_COLUMNS] as SemanticColumn[],
  fks: [...MOCK_FOREIGN_KEYS] as SemanticForeignKey[],
};

const listeners: Record<Topic, Set<() => void>> = {
  domains: new Set(),
  tables: new Set(),
  columns: new Set(),
  fks: new Set(),
};

const notify = (topic: Topic) => listeners[topic].forEach((l) => l());
const notifyAll = () => (Object.keys(listeners) as Topic[]).forEach(notify);

const makeSubscribe = (topic: Topic) => (l: () => void) => {
  listeners[topic].add(l);
  return () => {
    listeners[topic].delete(l);
  };
};

let loadPromise: Promise<void> | null = null;

export function reloadSemanticLayer() {
  loadPromise = Promise.all([
    listDomains(),
    listTables(),
    listColumns(),
    listForeignKeys(),
  ])
    .then(([domains, tables, columns, fks]) => {
      state.domains = domains;
      state.tables = tables;
      state.columns = columns;
      state.fks = fks;
      notifyAll();
    })
    .catch((error) => {
      console.error("Failed to load semantic layer", error);
    })
    .finally(() => {
      loadPromise = null;
    });
  return loadPromise;
}

function ensureLoaded() {
  if (!loadPromise) void reloadSemanticLayer();
}

function useSemanticSnapshot<T>(topic: Topic, getSnapshot: () => T) {
  useEffect(() => {
    ensureLoaded();
  }, []);
  return useSyncExternalStore(makeSubscribe(topic), getSnapshot, getSnapshot);
}

// ---------- React hooks (each returns a snapshot that re-renders on mutation) ----------
export const useDomains = () => useSemanticSnapshot("domains", () => state.domains);
export const useTables = () => useSemanticSnapshot("tables", () => state.tables);
export const useColumns = () => useSemanticSnapshot("columns", () => state.columns);
export const useForeignKeys = () => useSemanticSnapshot("fks", () => state.fks);

// ---------- Read-only helpers ----------
export const getDomains = () => state.domains;
export const getTables = () => state.tables;
export const getColumns = () => state.columns;
export const getForeignKeys = () => state.fks;

// ---------- Mutations ----------
export const setDomains = (next: SemanticDomain[]) => {
  const previous = state.domains;
  state.domains = next;
  notify("domains");
  void persistDomains(previous, next);
};
export const setTables = (next: SemanticTable[]) => {
  const previous = state.tables;
  state.tables = next;
  notify("tables");
  void persistTables(previous, next);
};
export const setColumns = (next: SemanticColumn[]) => {
  const previous = state.columns;
  state.columns = next;
  notify("columns");
  void persistColumns(previous, next);
};
export const setForeignKeys = (next: SemanticForeignKey[]) => {
  const previous = state.fks;
  state.fks = next;
  notify("fks");
  void persistForeignKeys(previous, next);
};

const changed = <T,>(a: T, b: T) => JSON.stringify(a) !== JSON.stringify(b);

async function persistDomains(previous: SemanticDomain[], next: SemanticDomain[]) {
  try {
    const prev = new Map(previous.map((x) => [x.id, x]));
    const current = new Map(next.map((x) => [x.id, x]));
    const removed = previous.filter((x) => !current.has(x.id)).map((x) => x.id);
    if (removed.length) await deleteDomains(removed);
    for (const item of next) {
      const old = prev.get(item.id);
      if (!old) {
        await createDomain(item);
      } else if (changed(old, item)) {
        await updateDomain(item.id, item);
      }
    }
    await reloadSemanticLayer();
  } catch (error) {
    console.error("Failed to persist semantic domains", error);
    await reloadSemanticLayer();
  }
}

async function persistTables(previous: SemanticTable[], next: SemanticTable[]) {
  try {
    const prev = new Map(previous.map((x) => [x.id, x]));
    const current = new Map(next.map((x) => [x.id, x]));
    const removed = previous.filter((x) => !current.has(x.id)).map((x) => x.id);
    if (removed.length) await deleteTables(removed);
    for (const item of next) {
      const old = prev.get(item.id);
      if (!old) {
        await createTable(item);
      } else if (changed(old, item)) {
        await updateTable(item.id, item);
      }
    }
    await reloadSemanticLayer();
  } catch (error) {
    console.error("Failed to persist semantic tables", error);
    await reloadSemanticLayer();
  }
}

async function persistColumns(previous: SemanticColumn[], next: SemanticColumn[]) {
  try {
    const prev = new Map(previous.map((x) => [x.id, x]));
    const current = new Map(next.map((x) => [x.id, x]));
    const removed = previous.filter((x) => !current.has(x.id)).map((x) => x.id);
    if (removed.length) await deleteColumns(removed);
    for (const item of next) {
      const old = prev.get(item.id);
      if (!old) {
        await createColumn(item.tableId, item);
      } else if (changed(old, item)) {
        await updateColumn(item.id, item);
      }
    }
    await reloadSemanticLayer();
  } catch (error) {
    console.error("Failed to persist semantic columns", error);
    await reloadSemanticLayer();
  }
}

async function persistForeignKeys(previous: SemanticForeignKey[], next: SemanticForeignKey[]) {
  try {
    const prev = new Map(previous.map((x) => [x.id, x]));
    const current = new Map(next.map((x) => [x.id, x]));
    const removed = previous.filter((x) => !current.has(x.id)).map((x) => x.id);
    if (removed.length) await deleteForeignKeys(removed);
    for (const item of next) {
      const old = prev.get(item.id);
      if (!old) {
        await createForeignKey(item);
      } else if (changed(old, item)) {
        await updateForeignKey(item.id, item);
      }
    }
    await reloadSemanticLayer();
  } catch (error) {
    console.error("Failed to persist semantic foreign keys", error);
    await reloadSemanticLayer();
  }
}
