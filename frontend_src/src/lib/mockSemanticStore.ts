// Shared in-memory store powering all 4 semantic layer pages.
// Uses React 18's useSyncExternalStore so any page seeing the store is
// automatically re-rendered when another page mutates it.

import { useSyncExternalStore } from "react";
import type {
  SemanticColumn,
  SemanticDomain,
  SemanticForeignKey,
  SemanticTable,
} from "@/types/app/semantic";
import {
  MOCK_COLUMNS,
  MOCK_DOMAINS,
  MOCK_FOREIGN_KEYS,
  MOCK_TABLES,
} from "@/lib/mockSemanticData";

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

const makeSubscribe = (topic: Topic) => (l: () => void) => {
  listeners[topic].add(l);
  return () => {
    listeners[topic].delete(l);
  };
};

// ---------- React hooks (each returns a snapshot that re-renders on mutation) ----------
export const useDomains = () =>
  useSyncExternalStore(makeSubscribe("domains"), () => state.domains, () => state.domains);
export const useTables = () =>
  useSyncExternalStore(makeSubscribe("tables"), () => state.tables, () => state.tables);
export const useColumns = () =>
  useSyncExternalStore(makeSubscribe("columns"), () => state.columns, () => state.columns);
export const useForeignKeys = () =>
  useSyncExternalStore(makeSubscribe("fks"), () => state.fks, () => state.fks);

// ---------- Read-only helpers ----------
export const getDomains = () => state.domains;
export const getTables = () => state.tables;
export const getColumns = () => state.columns;
export const getForeignKeys = () => state.fks;

// ---------- Mutations ----------
export const setDomains = (next: SemanticDomain[]) => {
  state.domains = next;
  notify("domains");
};
export const setTables = (next: SemanticTable[]) => {
  state.tables = next;
  notify("tables");
};
export const setColumns = (next: SemanticColumn[]) => {
  state.columns = next;
  notify("columns");
};
export const setForeignKeys = (next: SemanticForeignKey[]) => {
  state.fks = next;
  notify("fks");
};
