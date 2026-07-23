import {
  createSemanticLayerDb,
  initSemanticLayerDb,
  type SemanticLayerDb,
} from "@/server/semantic-layer/database";

type SemanticLayerRuntime = {
  db: SemanticLayerDb;
  ready: Promise<void>;
};

const globalSemanticLayer = globalThis as typeof globalThis & {
  semanticLayerRuntime?: SemanticLayerRuntime;
};

function createRuntime(): SemanticLayerRuntime {
  const db = createSemanticLayerDb(
    process.env.SEMANTIC_LAYER_DB_URL ?? "file:semantic-layer.db",
  );
  return { db, ready: initSemanticLayerDb(db) };
}

export const semanticLayerRuntime =
  globalSemanticLayer.semanticLayerRuntime ?? createRuntime();

if (process.env.NODE_ENV !== "production") {
  globalSemanticLayer.semanticLayerRuntime = semanticLayerRuntime;
}

export async function getSemanticLayerDb() {
  await semanticLayerRuntime.ready;
  return semanticLayerRuntime.db;
}
