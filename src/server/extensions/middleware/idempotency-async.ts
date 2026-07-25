import { createId, getDatabase, isoNow } from "@/server/http/context";

import {
  hashIdempotencyRequest,
  IdempotencyConflictError,
  responseResourceId,
} from "./idempotency";

const POLL_INTERVAL_MS = 20;
const WAIT_TIMEOUT_MS = 120_000;

export async function runIdempotentAsync<T>(
  ownerKey: string,
  routeCode: string,
  idempotencyKey: string,
  requestBody: unknown,
  mutate: () => Promise<T>,
): Promise<{ value: T; replayed: boolean }> {
  const requestHash = hashIdempotencyRequest(requestBody);
  const startedAt = Date.now();
  while (true) {
    const claim = claimRequest<T>(ownerKey, routeCode, idempotencyKey, requestHash);
    if (claim.kind === "replay") return { value: claim.value, replayed: true };
    if (claim.kind === "owner") break;
    const replay = await waitForResponse<T>(
      ownerKey,
      routeCode,
      idempotencyKey,
      requestHash,
      startedAt,
    );
    if (replay !== null) return { value: replay, replayed: true };
  }

  try {
    const value = await mutate();
    saveResponse(ownerKey, routeCode, idempotencyKey, requestHash, value);
    return { value, replayed: false };
  } catch (error) {
    clearReservation(ownerKey, routeCode, idempotencyKey, requestHash);
    throw error;
  }
}

function claimRequest<T>(
  ownerKey: string,
  routeCode: string,
  idempotencyKey: string,
  requestHash: string,
): { kind: "owner" | "pending" } | { kind: "replay"; value: T } {
  const db = getDatabase();
  let transactionStarted = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
    const row = db.prepare(`SELECT request_hash,response_json FROM idempotency_records
      WHERE user_id=? AND operation=? AND idempotency_key=?`)
      .get(ownerKey, routeCode, idempotencyKey) as {
        request_hash: string | null;
        response_json: string | null;
      } | undefined;
    if (row) {
      if (row.request_hash !== requestHash) throw new IdempotencyConflictError();
      db.exec("COMMIT");
      transactionStarted = false;
      return row.response_json
        ? { kind: "replay", value: JSON.parse(row.response_json) as T }
        : { kind: "pending" };
    }
    db.prepare(`INSERT INTO idempotency_records
      (id,user_id,operation,idempotency_key,resource_id,response_json,request_hash,created_at)
      VALUES (?,?,?,?,?,'',?,?)`)
      .run(createId("idem"), ownerKey, routeCode, idempotencyKey, "pending", requestHash, isoNow());
    db.exec("COMMIT");
    transactionStarted = false;
    return { kind: "owner" };
  } catch (error) {
    if (transactionStarted) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // SQLite may already have closed the transaction.
      }
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
): Promise<T | null> {
  while (Date.now() - startedAt < WAIT_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const db = getDatabase();
    try {
      const row = db.prepare(`SELECT request_hash,response_json FROM idempotency_records
        WHERE user_id=? AND operation=? AND idempotency_key=?`)
        .get(ownerKey, routeCode, idempotencyKey) as {
          request_hash: string | null;
          response_json: string | null;
        } | undefined;
      if (!row) return null;
      if (row.request_hash !== requestHash) throw new IdempotencyConflictError();
      if (row.response_json) return JSON.parse(row.response_json) as T;
    } finally {
      db.close();
    }
  }
  throw new Error("Timed out waiting for the idempotent operation to complete");
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
      WHERE user_id=? AND operation=? AND idempotency_key=? AND request_hash=? AND response_json=''`)
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
      WHERE user_id=? AND operation=? AND idempotency_key=? AND request_hash=? AND response_json=''`)
      .run(ownerKey, routeCode, idempotencyKey, requestHash);
  } finally {
    db.close();
  }
}
