import type { z } from "zod";

import type { syncMetadataSchema } from "@/server/semantic-layer/contract";

export type SyncInput = z.infer<typeof syncMetadataSchema>;
export type SyncTable = SyncInput["tables"][number];
export type SyncColumn = SyncTable["columns"][number];
export type SyncForeignKey = SyncInput["foreignKeys"][number];

export type SyncStats = {
  created: number;
  updated: number;
  missing: number;
};

export function blankStats(): SyncStats {
  return { created: 0, updated: 0, missing: 0 };
}

export function syncKey(table: string, column?: string) {
  return column ? `${table}.${column}` : table;
}
