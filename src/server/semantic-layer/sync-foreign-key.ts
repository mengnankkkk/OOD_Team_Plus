import {
  boolValue,
  nullable,
  type SemanticLayerExecutor,
} from "@/server/semantic-layer/database";
import { markMissingForeignKeys } from "@/server/semantic-layer/sync-missing";
import {
  blankStats,
  syncKey,
  type SyncForeignKey,
  type SyncInput,
} from "@/server/semantic-layer/sync-types";

type ResolvedForeignKey = {
  sourceTableId: string;
  sourceColumnId: string;
  targetTableId: string;
  targetColumnId: string;
  now: string;
};

export async function syncForeignKeys(
  db: SemanticLayerExecutor,
  input: SyncInput,
  tableMap: Map<string, string>,
  columnMap: Map<string, string>,
  tableIds: string[],
  now: string,
) {
  const stats = blankStats();
  const syncedIds: string[] = [];
  for (const fk of input.foreignKeys) {
    const resolved = resolveForeignKey(fk, tableMap, columnMap, now);
    if (!resolved) continue;
    const result = await upsertForeignKey(db, fk, resolved);
    syncedIds.push(result.id);
    stats[result.created ? "created" : "updated"] += 1;
  }
  if (input.markMissing) {
    stats.missing += await markMissingForeignKeys(db, tableIds, syncedIds, now);
  }
  return stats;
}

function resolveForeignKey(
  fk: SyncForeignKey,
  tableMap: Map<string, string>,
  columnMap: Map<string, string>,
  now: string,
) {
  const sourceTableId = tableMap.get(syncKey(fk.sourcePhysicalTableName));
  const targetTableId = tableMap.get(syncKey(fk.targetPhysicalTableName));
  const sourceColumnId = columnMap.get(
    syncKey(fk.sourcePhysicalTableName, fk.sourcePhysicalColumnName),
  );
  const targetColumnId = columnMap.get(
    syncKey(fk.targetPhysicalTableName, fk.targetPhysicalColumnName),
  );
  if (!sourceTableId || !targetTableId || !sourceColumnId || !targetColumnId) {
    return null;
  }
  return { sourceTableId, targetTableId, sourceColumnId, targetColumnId, now };
}

async function upsertForeignKey(
  db: SemanticLayerExecutor,
  fk: SyncForeignKey,
  resolved: ResolvedForeignKey,
) {
  const existing = await db.execute({
    sql: `select id from metadata_logical_foreign_keys
      where source_column_id = ? and target_column_id = ? limit 1`,
    args: [resolved.sourceColumnId, resolved.targetColumnId],
  });
  const id = (existing.rows[0]?.id as string | undefined) ?? crypto.randomUUID();
  if (existing.rows[0]) {
    await updateForeignKey(db, id, fk, resolved);
    return { id, created: false };
  }
  await insertForeignKey(db, id, fk, resolved);
  return { id, created: true };
}

async function updateForeignKey(
  db: SemanticLayerExecutor,
  id: string,
  fk: SyncForeignKey,
  resolved: ResolvedForeignKey,
) {
  await db.execute({
    sql: `update metadata_logical_foreign_keys set relation_type = ?,
      source_type = 'physical', confidence = ?, physical_description = ?,
      semantic_description = coalesce(semantic_description, ?),
      status = 'active', sync_status = 'active', updated_at = ? where id = ?`,
    args: [
      fk.relationType,
      fk.confidence,
      nullable(fk.physicalDescription),
      nullable(fk.semanticDescription),
      resolved.now,
      id,
    ],
  });
}

async function insertForeignKey(
  db: SemanticLayerExecutor,
  id: string,
  fk: SyncForeignKey,
  resolved: ResolvedForeignKey,
) {
  await db.execute({
    sql: `insert into metadata_logical_foreign_keys
      (id, source_table_id, source_column_id, target_table_id, target_column_id,
       relation_type, source_type, confidence, physical_description,
       semantic_description, is_visible, status, sync_status, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, 'physical', ?, ?, ?, ?, 'active', 'active', ?, ?)`,
    args: [
      id,
      resolved.sourceTableId,
      resolved.sourceColumnId,
      resolved.targetTableId,
      resolved.targetColumnId,
      fk.relationType,
      fk.confidence,
      nullable(fk.physicalDescription),
      nullable(fk.semanticDescription),
      boolValue(fk.isVisible ?? true),
      resolved.now,
      resolved.now,
    ],
  });
}
