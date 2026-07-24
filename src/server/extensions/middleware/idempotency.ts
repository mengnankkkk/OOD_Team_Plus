import { createHash } from "node:crypto";

import { createId, getDatabase, isoNow } from "@/server/http/context";

export interface IdempotencyRecord {
  ownerKey: string;
  routeCode: string;
  idempotencyKey: string;
  requestHash?: string;
  responseJson: string;
  createdAt: string;
  conflict?: boolean;
}

export async function checkIdempotency(ownerKey: string, routeCode: string, idempotencyKey: string, requestHash?: string): Promise<IdempotencyRecord | null> {
  const db = getDatabase();
  const row = db.prepare("SELECT user_id, operation, idempotency_key, request_hash, response_json, created_at FROM idempotency_records WHERE user_id = ? AND operation = ? AND idempotency_key = ?").get(ownerKey, routeCode, idempotencyKey) as { user_id: string; operation: string; idempotency_key: string; request_hash?: string; response_json?: string; created_at: string } | undefined;
  db.close();
  if (!row) return null;
  return { ownerKey: row.user_id, routeCode: row.operation, idempotencyKey: row.idempotency_key, requestHash: row.request_hash, responseJson: row.response_json ?? "", createdAt: row.created_at, conflict: Boolean(requestHash && (!row.request_hash || requestHash !== row.request_hash || !row.response_json)) };
}

export async function saveIdempotency(record: IdempotencyRecord): Promise<void> {
  const db = getDatabase();
  db.prepare("INSERT INTO idempotency_records (id, user_id, operation, idempotency_key, resource_id, response_json, request_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, operation, idempotency_key) DO NOTHING").run(createId("idem"), record.ownerKey, record.routeCode, record.idempotencyKey, safeResponseResource(record.responseJson), record.responseJson, record.requestHash ?? hashIdempotencyRequest(record.responseJson), record.createdAt);
  db.close();
}

export async function beginIdempotentRequest(ownerKey: string, routeCode: string, idempotencyKey: string, requestBody: unknown) {
  const requestHash = hashIdempotencyRequest(requestBody);
  const existing = await checkIdempotency(ownerKey, routeCode, idempotencyKey, requestHash);
  return { requestHash, existing };
}

export async function saveIdempotentResponse(ownerKey: string, routeCode: string, idempotencyKey: string, requestHash: string, response: unknown) {
  await saveIdempotency({ ownerKey, routeCode, idempotencyKey, requestHash, responseJson: JSON.stringify(response), createdAt: isoNow() });
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

function safeResponseResource(responseJson: string): string {
  try {
    const value = JSON.parse(responseJson) as { data?: { resourceId?: string; id?: string; searchId?: string; portfolioSnapshotId?: string } };
    return value.data?.resourceId ?? value.data?.id ?? value.data?.searchId ?? value.data?.portfolioSnapshotId ?? "response";
  } catch {
    return "response";
  }
}
