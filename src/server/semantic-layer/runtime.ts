import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createSemanticLayerDb,
  initSemanticLayerDb,
  type SemanticLayerDb,
} from "@/server/semantic-layer/database";

const DEFAULT_DB_PATH = "./data/mw-dev.db";

type SemanticLayerRuntime = {
  db: SemanticLayerDb;
  ready: Promise<void>;
};

const globalSemanticLayer = globalThis as typeof globalThis & {
  semanticLayerRuntime?: SemanticLayerRuntime;
};

function createRuntime(): SemanticLayerRuntime {
  const db = createSemanticLayerDb(getSemanticLayerDbUrl());
  return { db, ready: initSemanticLayerDb(db) };
}

function getSemanticLayerDbUrl() {
  if (process.env.SEMANTIC_LAYER_DB_URL) {
    return process.env.SEMANTIC_LAYER_DB_URL;
  }

  const dbPath = process.env.DB_PATH ?? DEFAULT_DB_PATH;
  if (dbPath === ":memory:") {
    return dbPath;
  }

  const resolvedPath = path.resolve(process.cwd(), dbPath);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  return pathToFileURL(resolvedPath).href;
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
