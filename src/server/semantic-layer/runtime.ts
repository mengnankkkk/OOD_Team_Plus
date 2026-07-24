import path from "node:path";

import { getDbClient } from "@/server/db/client";
import { createSemanticLayerDb, type SemanticLayerDb } from "@/server/semantic-layer/database";

type SemanticRuntime = { key: string; db: SemanticLayerDb };

const globalSemanticLayer = globalThis as typeof globalThis & {
  semanticLayerRuntime?: SemanticRuntime;
};

function runtimeKey(): string {
  const configured = process.env.DB_PATH ?? "./data/mw-dev.db";
  return configured === ":memory:" ? configured : path.resolve(process.cwd(), configured);
}

export async function getSemanticLayerDb(): Promise<SemanticLayerDb> {
  const key = runtimeKey();
  if (globalSemanticLayer.semanticLayerRuntime?.key !== key) {
    globalSemanticLayer.semanticLayerRuntime?.db.close();
    globalSemanticLayer.semanticLayerRuntime = { key, db: createSemanticLayerDb(getDbClient()) };
  }
  return globalSemanticLayer.semanticLayerRuntime.db;
}

export function closeSemanticLayerRuntime(): void {
  globalSemanticLayer.semanticLayerRuntime?.db.close();
  delete globalSemanticLayer.semanticLayerRuntime;
}
