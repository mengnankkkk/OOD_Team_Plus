import { createId, getDatabase, isoNow } from "@/server/http/context";

import {
  hashIdempotencyRequest,
  IdempotencyConflictError,
  responseResourceId,
} from "./idempotency";

const POLL_INTERVAL_MS = 20;
const WAIT_TIMEOUT_MS = 120_000;
const DEFAULT_STALE_AFTER_MS = 10 * 60 * 1_000;

export type AsyncIdempotencyRecovery<T> =
  | { kind: "replay"; value: T }
  | { kind: "retry" }
  | { kind: "pending" }
  | null;

type AsyncIdempotencyOptions<T> = {
  recover?: () => Promise<AsyncIdempotencyRecovery<T>>;
  staleAfterMs?: number;
};

type Claim<T> =
  | { kind: "owner" }
  | { kind: "pending"; createdAt: string }
  | { kind: "replay"; value: T };

export async function runIdempotentAsync<T>(
  ownerKey: string,
  routeCode: string,
  idempotencyKey: string,
  requestBody: unknown,
  mutate: () => Promise<T>,
  options: AsyncIdempotencyOptions<T> = {},
): Promise<{ value: T; replayed: boolean }> {
  const requestHash = hashIdempotencyRequest(requestBody);
  const startedAt = Date.now();
  while (true) {
    const claim = claimRequest<T>(ownerKey, routeCode, idempotencyKey, requestHash);
    if (claim.kind === "replay") return { value: claim.value, replayed: true };
    if (claim.kind === "owner") break;
    const recovery = await recoverPending(ownerKey, routeCode, idempotencyKey, requestHash, claim.createdAt, options);
    if (recovery?.kind === "replay") {
      return { value: recovery.value, replayed: true };
    }
    if (recovery?.kind === "retry") continue;
    const replay = await waitForResponse<T>(ownerKey, routeCode, idempotencyKey, requestHash, startedAt, options);
    if (replay.kind === "replay") return { value: replay.value, replayed: true };
  }

  let value: T;
  try {
    value = await mutate();
  } catch (error) {
    clearReservation(ownerKey, routeCode, idempotencyKey, requestHash);
    throw error;
  }
  saveResponseBestEffort(ownerKey, routeCode, idempotencyKey, requestHash, value);
  return { value, replayed: false };
}

function claimRequest<T>(
  ownerKey: string,
  routeCode: string,
  idempotencyKey: string,
  requestHash: string,
): Claim<T> {
  const db = getDatabase();
  let transactionStarted = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
    const row = db.prepare(`SELECT request_hash,response_json,created_at
      FROM idempotency_records
      WHERE user_id=? AND operation=? AND idempotency_key=?`)
      .get(ownerKey, routeCode, idempotencyKey) as {
        request_hash: string | null;
        response_json: string | null;
        created_at: string;
      } | undefined;
    if (row) {
      if (row.request_hash !== requestHash) throw new IdempotencyConflictError();
      db.exec("COMMIT");
      transactionStarted = false;
      return row.response_json
        ? { kind: "replay", value: JSON.parse(row.response_json) as T }
        : { kind: "pending", createdAt: row.created_at };
    }
    db.prepare(`INSERT INTO idempotency_records
      (id,user_id,operation,idempotency_key,resource_id,response_json,request_hash,created_at)
      VALUES (?,?,?,?,?,'',?,?)`)
      .run(
        createId("idem"),
        ownerKey,
        routeCode,
        idempotencyKey,
        "pending",
        requestHash,
        isoNow(),
      );
    db.exec("COMMIT");
    transactionStarted = false;
    return { kind: "owner" };
  } catch (error) {
    if (transactionStarted) {
      try { db.exec("ROLLBACK"); } catch { /* Transaction may already be closed. */ }
    }
    throw error;
  } finally {
    db.close();
  }
}

async function waitForResponse<T>(
  ownerKey: string,
  routeCode: string,
  idempotencyKey: string,
  requestHash: string,
  startedAt: number,
  options: AsyncIdempotencyOptions<T>,
): Promise<{ kind: "replay"; value: T } | { kind: "retry" }> {
  while (Date.now() - startedAt < WAIT_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const row = readPending(ownerKey, routeCode, idempotencyKey, requestHash);
    if (!row) return { kind: "retry" };
    if (row.responseJson) {
      return { kind: "replay", value: JSON.parse(row.responseJson) as T };
    }
    const recovery = await recoverPending(ownerKey, routeCode, idempotencyKey, requestHash, row.createdAt, options);
    if (recovery?.kind === "replay" || recovery?.kind === "retry") return recovery;
  }
  throw new Error("Timed out waiting for the idempotent operation to complete");
}

async function recoverPending<T>(
  ownerKey: string,
  routeCode: string,
  idempotencyKey: string,
  requestHash: string,
  createdAt: string,
  options: AsyncIdempotencyOptions<T>,
): Promise<{ kind: "replay"; value: T } | { kind: "retry" } | null> {
  const recovery = await options.recover?.() ?? null;
  if (recovery?.kind === "replay") {
    saveResponseBestEffort(ownerKey, routeCode, idempotencyKey, requestHash, recovery.value);
    return recovery;
  }
  if (recovery?.kind === "retry") {
    clearReservation(ownerKey, routeCode, idempotencyKey, requestHash);
    return recovery;
  }
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  if (recovery === null && Date.now() - Date.parse(createdAt) >= staleAfterMs) {
    clearReservation(ownerKey, routeCode, idempotencyKey, requestHash);
    return { kind: "retry" };
  }
  return null;
}

function readPending(
  ownerKey: string,
  routeCode: string,
  idempotencyKey: string,
  requestHash: string,
): { responseJson: string; createdAt: string } | null {
  const db = getDatabase();
  try {
    const row = db.prepare(`SELECT request_hash,response_json,created_at
      FROM idempotency_records
      WHERE user_id=? AND operation=? AND idempotency_key=?`)
      .get(ownerKey, routeCode, idempotencyKey) as {
        request_hash: string | null;
        response_json: string | null;
        created_at: string;
      } | undefined;
    if (!row) return null;
    if (row.request_hash !== requestHash) throw new IdempotencyConflictError();
    return { responseJson: row.response_json ?? "", createdAt: row.created_at };
  } finally {
    db.close();
  }
}

function saveResponseBestEffort<T>(
  ownerKey: string,
  routeCode: string,
  idempotencyKey: string,
  requestHash: string,
  value: T,
): boolean {
  try {
    saveResponse(ownerKey, routeCode, idempotencyKey, requestHash, value);
    return true;
  } catch {
    return false;
  }
}

function saveResponse<T>(
  ownerKey: string,
  routeCode: string,
  idempotencyKey: string,
  requestHash: string,
  value: T,
): void {
  const responseJson = JSON.stringify(value);
  const db = getDatabase();
  try {
    const result = db.prepare(`UPDATE idempotency_records
      SET resource_id=?,response_json=?
      WHERE user_id=? AND operation=? AND idempotency_key=? AND request_hash=?
        AND response_json=''`)
      .run(
        responseResourceId(responseJson),
        responseJson,
        ownerKey,
        routeCode,
        idempotencyKey,
        requestHash,
      );
    if (!result.changes) throw new Error("Idempotent operation reservation was lost");
  } finally {
    db.close();
  }
}

function clearReservation(
  ownerKey: string,
  routeCode: string,
  idempotencyKey: string,
  requestHash: string,
): void {
  const db = getDatabase();
  try {
    db.prepare(`DELETE FROM idempotency_records
      WHERE user_id=? AND operation=? AND idempotency_key=? AND request_hash=?
        AND response_json=''`)
      .run(ownerKey, routeCode, idempotencyKey, requestHash);
  } finally {
    db.close();
  }
}
