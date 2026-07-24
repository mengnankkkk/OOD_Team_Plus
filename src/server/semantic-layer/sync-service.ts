import {
  nowIso,
  type SemanticLayerDb,
  type SemanticLayerExecutor,
} from "@/server/semantic-layer/database";
import { syncForeignKeys } from "@/server/semantic-layer/sync-foreign-key";
import {
  markMissingColumns,
  markMissingTables,
} from "@/server/semantic-layer/sync-missing";
import { blankStats, syncKey, type SyncInput } from "@/server/semantic-layer/sync-types";
import {
  upsertColumn,
  upsertDomain,
  upsertTable,
} from "@/server/semantic-layer/sync-upsert";

export async function syncSemanticMetadata(db: SemanticLayerDb, input: SyncInput) {
  const transaction = await db.transaction("write");
  try {
    const stats = await syncMetadataSnapshot(transaction, input);
    await transaction.commit();
    return stats;
  } catch (error) {
    if (!transaction.closed) {
      await transaction.rollback();
    }
    throw error;
  } finally {
    if (!transaction.closed) {
      transaction.close();
    }
  }
}

async function syncMetadataSnapshot(
  db: SemanticLayerExecutor,
  input: SyncInput,
) {
  const now = nowIso();
  const stats = {
    domain: blankStats(),
    tables: blankStats(),
    columns: blankStats(),
    foreignKeys: blankStats(),
    syncedAt: now,
  };
  const domain = await upsertDomain(db, input, now);
  stats.domain[domain.created ? "created" : "updated"] += 1;
  const tableIds: string[] = [];
  const tableMap = new Map<string, string>();
  const columnMap = new Map<string, string>();

  for (const table of input.tables) {
    const tableResult = await upsertTable(db, input, domain.id, table, now);
    stats.tables[tableResult.created ? "created" : "updated"] += 1;
    tableIds.push(tableResult.id);
    tableMap.set(syncKey(table.physicalTableName), tableResult.id);
    const columnIds: string[] = [];
    for (const column of table.columns) {
      const result = await upsertColumn(db, tableResult.id, column, now);
      stats.columns[result.created ? "created" : "updated"] += 1;
      columnIds.push(result.id);
      columnMap.set(syncKey(table.physicalTableName, column.physicalColumnName), result.id);
    }
    if (input.markMissing) {
      stats.columns.missing += await markMissingColumns(db, tableResult.id, columnIds, now);
    }
  }

  if (input.markMissing) {
    stats.tables.missing += await markMissingTables(db, input, domain.id, tableIds, now);
  }
  stats.foreignKeys = await syncForeignKeys(
    db,
    input,
    tableMap,
    columnMap,
    tableIds,
    now,
  );
  return stats;
}
