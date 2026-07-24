export interface IdempotencyRecord {
  ownerKey: string;
  routeCode: string;
  idempotencyKey: string;
  responseJson: string;
  createdAt: string;
}

export async function checkIdempotency(
  ownerKey: string,
  routeCode: string,
  idempotencyKey: string,
): Promise<IdempotencyRecord | null> {
  const db = getDatabase();
  const row = db.prepare("SELECT user_id, operation, idempotency_key, response_json, created_at FROM idempotency_records WHERE user_id = ? AND operation = ? AND idempotency_key = ?").get(ownerKey, routeCode, idempotencyKey) as { user_id: string; operation: string; idempotency_key: string; response_json?: string; created_at: string } | undefined;
  db.close();
  if (!row) return null;
  return { ownerKey: row.user_id, routeCode: row.operation, idempotencyKey: row.idempotency_key, responseJson: row.response_json ?? "", createdAt: row.created_at };
}

export async function saveIdempotency(record: IdempotencyRecord): Promise<void> {
  const parsed = safeResponseResource(record.responseJson);
  const requestHash = createHash("sha256").update(record.responseJson).digest("hex");
  const db = getDatabase();
  db.prepare("INSERT INTO idempotency_records (id, user_id, operation, idempotency_key, resource_id, response_json, request_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, operation, idempotency_key) DO NOTHING").run(createId("idem"), record.ownerKey, record.routeCode, record.idempotencyKey, parsed, record.responseJson, requestHash, record.createdAt);
  db.close();
}

function safeResponseResource(responseJson: string): string {
  try {
    const value = JSON.parse(responseJson) as { data?: { resourceId?: string; id?: string } };
    return value.data?.resourceId ?? value.data?.id ?? "response";
  } catch {
    return "response";
  }
}
import { createHash } from "node:crypto";

import { createId, getDatabase, isoNow } from "@/server/http/context";
