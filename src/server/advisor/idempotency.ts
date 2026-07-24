import { createHash } from "node:crypto";

import type { AdvisorDatabase } from "@/server/advisor/database";
import { json, runValue, runWrite } from "@/server/advisor/store-common";

export function requestHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function getIdempotentResponse(database: AdvisorDatabase, userId: string, operation: string, key?: string | null) {
  if (!key) return null;
  const row = runValue<{ response_status: number; response_json: string; request_hash: string }>(
    database,
    "SELECT response_status, response_json, request_hash FROM idempotency_records WHERE user_id = ? AND operation = ? AND idempotency_key = ?",
    userId,
    operation,
    key,
  );
  if (!row) return null;
  return { status: row.response_status, body: JSON.parse(row.response_json), requestHash: row.request_hash };
}

export function saveIdempotentResponse(
  database: AdvisorDatabase,
  userId: string,
  operation: string,
  key: string | null | undefined,
  body: unknown,
  status: number,
  hash: string,
) {
  if (!key) return;
  runWrite(
    database,
    `INSERT INTO idempotency_records
     (id, user_id, operation, idempotency_key, request_hash, response_status, response_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    `idempotency_${crypto.randomUUID()}`,
    userId,
    operation,
    key,
    hash,
    status,
    json(body),
    new Date().toISOString(),
  );
}
