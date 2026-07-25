import {
  createExternalClientInTransaction,
  rotateExternalClientTokenInTransaction,
  type CreateExternalClientInput,
} from "./client-write-service";
import {
  A2APublicError,
  type ExternalClientView,
} from "./contracts";
import { hashIdempotencyRequest } from "@/server/extensions/middleware/idempotency";
import { createId, getDatabase, isoNow } from "@/server/http/context";

type IdempotentOperationResult<T> =
  | { kind: "live"; value: T }
  | { kind: "replay"; response: unknown };

type IdempotencyRow = {
  request_hash: string | null;
  response_json: string | null;
};

export function createExternalClientIdempotently(
  actorUserId: string,
  input: CreateExternalClientInput,
  idempotency: { key: string; responseMeta: Record<string, unknown> },
): IdempotentOperationResult<{ client: ExternalClientView; token: string }> {
  const routeCode = "admin_a2a_client_create";
  return runIdempotently({
    actorUserId,
    routeCode,
    key: idempotency.key,
    requestHash: hashIdempotencyRequest(input),
    execute: (db) => {
      const created = createExternalClientInTransaction(db, actorUserId, input);
      return {
        liveValue: created,
        resourceId: created.client.id,
        replayResponse: {
          data: { client: created.client },
          meta: idempotency.responseMeta,
        },
      };
    },
  });
}

export function rotateExternalClientTokenIdempotently(
  actorUserId: string,
  clientId: string,
  idempotency: { key: string; responseMeta: Record<string, unknown> },
): IdempotentOperationResult<{ token: string; tokenPrefix: string }> {
  const routeCode = `admin_a2a_client_rotate:${clientId}`;
  return runIdempotently({
    actorUserId,
    routeCode,
    key: idempotency.key,
    requestHash: hashIdempotencyRequest({ clientId }),
    execute: (db) => {
      const rotated = rotateExternalClientTokenInTransaction(db, actorUserId, clientId);
      return {
        liveValue: rotated,
        resourceId: clientId,
        replayResponse: {
          data: { tokenPrefix: rotated.tokenPrefix },
          meta: idempotency.responseMeta,
        },
      };
    },
  });
}

function runIdempotently<T>(input: {
  actorUserId: string;
  routeCode: string;
  key: string;
  requestHash: string;
  execute: (db: ReturnType<typeof getDatabase>) => {
    liveValue: T;
    resourceId: string;
    replayResponse: unknown;
  };
}): IdempotentOperationResult<T> {
  const db = getDatabase();
  try {
    let outcome: IdempotentOperationResult<T> | undefined;
    const transaction = db.transaction(() => {
      const claim = claimIdempotency(
        db,
        input.actorUserId,
        input.routeCode,
        input.key,
        input.requestHash,
      );
      if (claim.kind === "replay") {
        outcome = claim;
        return;
      }
      const executed = input.execute(db);
      completeIdempotency(
        db,
        input.actorUserId,
        input.routeCode,
        input.key,
        executed.resourceId,
        executed.replayResponse,
      );
      outcome = { kind: "live", value: executed.liveValue };
    });
    transaction();
    return requireTransactionResult(outcome);
  } finally {
    db.close();
  }
}

function claimIdempotency(
  db: ReturnType<typeof getDatabase>,
  ownerKey: string,
  routeCode: string,
  key: string,
  requestHash: string,
): { kind: "claimed" } | { kind: "replay"; response: unknown } {
  const claimed = db.prepare(`INSERT INTO idempotency_records
    (id,user_id,operation,idempotency_key,resource_id,response_json,request_hash,created_at)
    VALUES (?,?,?,?,?,'',?,?)
    ON CONFLICT(user_id,operation,idempotency_key) DO NOTHING`).run(
    createId("idem"),
    ownerKey,
    routeCode,
    key,
    "pending",
    requestHash,
    isoNow(),
  );
  if (claimed.changes === 1) return { kind: "claimed" };

  const existing = db.prepare(`SELECT request_hash,response_json
    FROM idempotency_records
    WHERE user_id=? AND operation=? AND idempotency_key=?`).get(
    ownerKey,
    routeCode,
    key,
  ) as IdempotencyRow | undefined;
  if (!existing || existing.request_hash !== requestHash || !existing.response_json) {
    throw new A2APublicError(
      "IDEMPOTENCY_CONFLICT",
      409,
      "Idempotency-Key was already used with a different request",
    );
  }
  return { kind: "replay", response: parseStoredResponse(existing.response_json) };
}

function completeIdempotency(
  db: ReturnType<typeof getDatabase>,
  ownerKey: string,
  routeCode: string,
  key: string,
  resourceId: string,
  response: unknown,
): void {
  const result = db.prepare(`UPDATE idempotency_records
    SET resource_id=?,response_json=?
    WHERE user_id=? AND operation=? AND idempotency_key=?`).run(
    resourceId,
    JSON.stringify(response),
    ownerKey,
    routeCode,
    key,
  );
  if (result.changes !== 1) throw new Error("Failed to complete A2A idempotency record");
}

function parseStoredResponse(responseJson: string): unknown {
  try {
    return JSON.parse(responseJson) as unknown;
  } catch {
    throw new A2APublicError(
      "IDEMPOTENCY_CONFLICT",
      409,
      "Stored idempotency response is invalid",
    );
  }
}

function requireTransactionResult<T>(result: T | undefined): T {
  if (result === undefined) throw new Error("A2A transaction completed without a result");
  return result;
}
