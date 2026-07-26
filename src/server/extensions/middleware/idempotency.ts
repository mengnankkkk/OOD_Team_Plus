import { createHash } from "node:crypto";

import { createId, getDatabase, isoNow } from "@/server/http/context";

type Db = ReturnType<typeof getDatabase>;

export interface IdempotencyRecord {
  ownerKey: string;
  routeCode: string;
  idempotencyKey: string;
  requestHash?: string;
  responseJson: string;
  createdAt: string;
  active?: boolean;
  conflict?: boolean;
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency-Key was already used with a different request");
    this.name = "IdempotencyConflictError";
  }
}

export function runIdempotentMutation<T>(
  ownerKey: string,
  routeCode: string,
  idempotencyKey: string,
  requestBody: unknown,
  mutate: (db: Db) => T,
): { value: T; replayed: boolean } {
  const db = getDatabase();
  const requestHash = hashIdempotencyRequest(requestBody);
  let transactionStarted = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
    const existing = db.prepare(`SELECT request_hash,response_json
      FROM idempotency_records
      WHERE user_id=? AND operation=? AND idempotency_key=?`)
      .get(ownerKey, routeCode, idempotencyKey) as {
        request_hash?: string;
        response_json?: string | null;
      } | undefined;
    if (existing) {
      if (!existing.response_json || existing.request_hash !== requestHash) {
        throw new IdempotencyConflictError();
      }
      const value = JSON.parse(existing.response_json) as T;
      db.exec("COMMIT");
      transactionStarted = false;
      return { value, replayed: true };
    }

    const value = mutate(db);
    const responseJson = JSON.stringify(value);
    db.prepare(`INSERT INTO idempotency_records
      (id,user_id,operation,idempotency_key,resource_id,response_json,request_hash,created_at)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(
        createId("idem"),
        ownerKey,
        routeCode,
        idempotencyKey,
        responseResourceId(responseJson),
        responseJson,
        requestHash,
        isoNow(),
      );
    db.exec("COMMIT");
    transactionStarted = false;
    return { value, replayed: false };
  } catch (error) {
    if (transactionStarted) {
      try { db.exec("ROLLBACK"); } catch { /* SQLite may already have closed it. */ }
    }
    throw error;
  } finally {
    db.close();
  }
}

export async function checkIdempotency(ownerKey: string, routeCode: string, idempotencyKey: string, requestHash?: string): Promise<IdempotencyRecord | null> {
  const db = getDatabase();
  try {
    const row = db.prepare("SELECT user_id, operation, idempotency_key, request_hash, response_json, created_at FROM idempotency_records WHERE user_id = ? AND operation = ? AND idempotency_key = ?").get(ownerKey, routeCode, idempotencyKey) as IdempotencyRow | undefined;
    return row ? toIdempotencyRecord(row, requestHash) : null;
  } finally {
    db.close();
  }
}

export async function saveIdempotency(record: IdempotencyRecord): Promise<void> {
  const db = getDatabase();
  try {
    db.prepare(`INSERT INTO idempotency_records
      (id, user_id, operation, idempotency_key, resource_id, response_json, request_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, operation, idempotency_key) DO UPDATE SET
        resource_id=excluded.resource_id,
        response_json=excluded.response_json
      WHERE idempotency_records.request_hash=excluded.request_hash
        AND idempotency_records.response_json IS NULL`)
      .run(createId("idem"), record.ownerKey, record.routeCode, record.idempotencyKey, responseResourceId(record.responseJson), record.responseJson, record.requestHash ?? hashIdempotencyRequest(record.responseJson), record.createdAt);
  } finally {
    db.close();
  }
}

export async function beginIdempotentRequest(ownerKey: string, routeCode: string, idempotencyKey: string, requestBody: unknown, options: { reserve?: boolean } = {}) {
  const requestHash = hashIdempotencyRequest(requestBody);
  if (!options.reserve) {
    const existing = await checkIdempotency(ownerKey, routeCode, idempotencyKey, requestHash);
    return { requestHash, existing };
  }
  const db = getDatabase();
  try {
    for (;;) {
      const reserved = db.prepare("INSERT INTO idempotency_records (id, user_id, operation, idempotency_key, resource_id, response_json, request_hash, created_at) VALUES (?, ?, ?, ?, 'pending', NULL, ?, ?) ON CONFLICT(user_id, operation, idempotency_key) DO NOTHING")
        .run(createId("idem"), ownerKey, routeCode, idempotencyKey, requestHash, isoNow());
      if (reserved.changes === 1) return { requestHash, existing: null };
      const row = db.prepare("SELECT user_id, operation, idempotency_key, request_hash, response_json, created_at FROM idempotency_records WHERE user_id = ? AND operation = ? AND idempotency_key = ?")
        .get(ownerKey, routeCode, idempotencyKey) as IdempotencyRow | undefined;
      if (row) return { requestHash, existing: toIdempotencyRecord(row, requestHash) };
    }
  } finally {
    db.close();
  }
}

export async function saveIdempotentResponse(ownerKey: string, routeCode: string, idempotencyKey: string, requestHash: string, response: unknown) {
  await saveIdempotency({ ownerKey, routeCode, idempotencyKey, requestHash, responseJson: JSON.stringify(response), createdAt: isoNow() });
}

export async function releaseIdempotentRequest(ownerKey: string, routeCode: string, idempotencyKey: string, requestHash: string): Promise<void> {
  const db = getDatabase();
  try {
    db.prepare(`DELETE FROM idempotency_records
      WHERE user_id=? AND operation=? AND idempotency_key=?
        AND request_hash=? AND response_json IS NULL`)
      .run(ownerKey, routeCode, idempotencyKey, requestHash);
  } finally {
    db.close();
  }
}

export function parseIdempotentResponse(record: IdempotencyRecord): unknown {
  try {
    return JSON.parse(record.responseJson) as unknown;
  } catch {
    return null;
  }
}

export function hashIdempotencyRequest(value: unknown): string {
  const normalized = typeof value === "string" ? value : stableJson(value);
  return createHash("sha256").update(normalized).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function responseResourceId(responseJson: string): string {
  try {
    const value = JSON.parse(responseJson) as { data?: { resourceId?: string; id?: string; searchId?: string; portfolioSnapshotId?: string } };
    return value.data?.resourceId ?? value.data?.id ?? value.data?.searchId ?? value.data?.portfolioSnapshotId ?? "response";
  } catch {
    return "response";
  }
}

type IdempotencyRow = {
  user_id: string;
  operation: string;
  idempotency_key: string;
  request_hash?: string;
  response_json?: string;
  created_at: string;
};

function toIdempotencyRecord(row: IdempotencyRow, requestHash?: string): IdempotencyRecord {
  return {
    ownerKey: row.user_id,
    routeCode: row.operation,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    responseJson: row.response_json ?? "",
    createdAt: row.created_at,
    active: Boolean(!row.response_json && row.request_hash && (!requestHash || requestHash === row.request_hash)),
    conflict: Boolean(requestHash && (!row.request_hash || requestHash !== row.request_hash)),
  };
}
