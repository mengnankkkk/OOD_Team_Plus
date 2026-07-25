import { createHash, timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

import {
  A2A_CAPABILITIES,
  A2APublicError,
  type A2ACapability,
  type ExternalClientPrincipal,
} from "./contracts";
import { getDatabase, isoNow, parseJson } from "@/server/http/context";

export const A2A_SERVICE_USER_ID = "a2a-remote-agent";

export type A2AAuthFailure = {
  status: number;
  code: string;
  message: string;
};

type AuthTokenRow = {
  token_id: string;
  token_hash: string;
  client_id: string;
  name: string;
  capabilities_json: string;
  rate_limit_per_minute: number;
};

const rateLimitWindows = new Map<string, number[]>();

export { A2APublicError as A2AAuthError };

export function authenticateA2A(request: NextRequest): A2AAuthFailure | null {
  try {
    authenticateExternalRequest(request);
    return null;
  } catch (error) {
    if (error instanceof A2APublicError) {
      return { status: error.status, code: error.code, message: error.message };
    }
    return { status: 500, code: "A2A_AUTH_FAILED", message: "A2A authentication failed." };
  }
}

export function authenticateExternalToken(rawToken: string): ExternalClientPrincipal | null {
  const supplied = rawToken.trim();
  if (!supplied) return null;
  const calculatedHash = createHash("sha256").update(supplied).digest("hex");
  const db = getDatabase();
  try {
    const row = db.prepare(`SELECT
        t.id AS token_id,
        t.token_hash,
        c.id AS client_id,
        c.name,
        c.capabilities_json,
        c.rate_limit_per_minute
      FROM a2a_external_client_tokens t
      JOIN a2a_external_clients c ON c.id=t.external_client_id
      WHERE t.token_hash=? AND t.revoked_at IS NULL AND c.status='ACTIVE'
      LIMIT 1`).get(calculatedHash) as AuthTokenRow | undefined;
    if (row && secureEqual(row.token_hash, calculatedHash)) {
      enforceRateLimit(row.client_id, row.rate_limit_per_minute);
      const now = isoNow();
      const transaction = db.transaction(() => {
        db.prepare("UPDATE a2a_external_client_tokens SET last_used_at=? WHERE id=?").run(now, row.token_id);
        db.prepare("UPDATE a2a_external_clients SET last_used_at=? WHERE id=?").run(now, row.client_id);
      });
      transaction();
      return {
        clientId: row.client_id,
        name: row.name,
        capabilities: parseJson<A2ACapability[]>(row.capabilities_json, []),
        rateLimitPerMinute: row.rate_limit_per_minute,
      };
    }
  } finally {
    db.close();
  }

  const legacyToken = process.env.A2A_BEARER_TOKEN?.trim() ?? "";
  if (!legacyToken || !secureEqual(legacyToken, supplied)) return null;
  const principal = {
    clientId: "a2a-legacy-client",
    name: "Legacy A2A client",
    capabilities: [...A2A_CAPABILITIES],
    rateLimitPerMinute: 10_000,
  } satisfies ExternalClientPrincipal;
  enforceRateLimit(principal.clientId, principal.rateLimitPerMinute);
  return principal;
}

export function authenticateExternalRequest(request: NextRequest): ExternalClientPrincipal {
  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/iu)?.[1]?.trim() ?? "";
  const principal = authenticateExternalToken(supplied);
  if (!principal) {
    throw new A2APublicError("UNAUTHENTICATED", 401, "Bearer token is required.");
  }
  return principal;
}

export function requireA2ACapability(
  principal: ExternalClientPrincipal,
  capability: A2ACapability,
): void {
  if (!principal.capabilities.includes(capability)) {
    throw new A2APublicError(
      "A2A_CAPABILITY_FORBIDDEN",
      403,
      `A2A capability '${capability}' is not enabled for this client.`,
    );
  }
}

export function resetA2ARateLimitsForTests(): void {
  rateLimitWindows.clear();
}

function enforceRateLimit(clientId: string, limit: number): void {
  const now = Date.now();
  const cutoff = now - 60_000;
  const activeHits = (rateLimitWindows.get(clientId) ?? []).filter((hitAt) => hitAt > cutoff);
  if (activeHits.length >= limit) {
    rateLimitWindows.set(clientId, activeHits);
    throw new A2APublicError("A2A_RATE_LIMITED", 429, "A2A client rate limit exceeded.");
  }
  activeHits.push(now);
  rateLimitWindows.set(clientId, activeHits);
}

function secureEqual(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}
