import { createHash, randomUUID } from "node:crypto";

import { NextRequest } from "next/server";

import { getDatabase, isoNow } from "@/server/http/context";

export const TEST_USER_ID = "test-auth-user";
export const TEST_PORTFOLIO_ID = `portfolio-${TEST_USER_ID}`;
export const TEST_PORTFOLIO_SNAPSHOT_ID = `portfolio-snapshot-${TEST_USER_ID}`;

type TestRole = "USER" | "ADMIN";

export function authenticatedRequest(
  url: string,
  init: RequestInit = {},
  options: { userId?: string; role?: TestRole; username?: string } = {},
): NextRequest {
  const userId = options.userId ?? TEST_USER_ID;
  const role = options.role ?? "ADMIN";
  const username = options.username ?? userId.replaceAll(/[^a-z0-9_]/giu, "_").toLowerCase();
  const token = seedAuthenticatedUser({ userId, role, username });
  const headers = new Headers(init.headers);
  const existingCookie = headers.get("cookie");
  headers.set("cookie", [existingCookie, `mw_session=${token}`].filter(Boolean).join("; "));
  const { signal, ...rest } = init;
  return new NextRequest(url, { ...rest, signal: signal ?? undefined, headers });
}

export function seedAuthenticatedUser(input: { userId?: string; role?: TestRole; username?: string; token?: string } = {}): string {
  const userId = input.userId ?? TEST_USER_ID;
  const role = input.role ?? "ADMIN";
  const username = input.username ?? userId.replaceAll(/[^a-z0-9_]/giu, "_").toLowerCase();
  const token = input.token ?? `test-session-${randomUUID()}`;
  const now = isoNow();
  const db = getDatabase();
  db.prepare(`INSERT OR IGNORE INTO users
    (id,username,username_normalized,display_name,role,status,force_password_change,created_at,updated_at,row_version)
    VALUES (?,?,?,?,?,'ACTIVE',0,?,?,1)`).run(
    userId, username, username, "Test Investor", role, now, now,
  );
  db.prepare(`INSERT INTO api_sessions
    (id,user_id,token_hash,expires_at,created_at,last_seen_at)
    VALUES (?,?,?,?,?,?)`).run(
    `session_${randomUUID().replaceAll("-", "")}`,
    userId,
    createHash("sha256").update(token).digest("hex"),
    "2099-01-01T00:00:00.000Z",
    now,
    now,
  );
  seedPortfolio(db, userId, now);
  db.close();
  return token;
}

function seedPortfolio(db: ReturnType<typeof getDatabase>, userId: string, now: string): void {
  const snapshotId = `portfolio-snapshot-${userId}`;
  db.prepare(`INSERT OR IGNORE INTO portfolio_snapshots
    (id,user_id,portfolio_id,cash_decimal,total_market_value_decimal,data_quality,source_statuses_json,as_of,created_at)
    VALUES (?,?,?,'10000','500','complete','[{"source":"TEST_FIXTURE","status":"SUCCEEDED"}]',?,?)`).run(
    snapshotId, userId, `portfolio-${userId}`, now, now,
  );
  for (const holding of [
    [`holding-snapshot-aapl-${userId}`, "AAPL", "2", "140", "150", "300", "20", 6000],
    [`holding-snapshot-msft-${userId}`, "MSFT", "1", "190", "200", "200", "10", 4000],
  ] as const) {
    db.prepare(`INSERT OR IGNORE INTO holding_snapshots
      (id,portfolio_snapshot_id,instrument_id,quantity_decimal,cost_decimal,price_decimal,market_value_decimal,unrealized_pnl_decimal,weight_bps,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(holding[0], snapshotId, ...holding.slice(1), now);
  }
  for (const holding of [
    [`holding-aapl-${userId}`, "AAPL", "2", "140"],
    [`holding-msft-${userId}`, "MSFT", "1", "190"],
  ] as const) {
    db.prepare(`INSERT OR IGNORE INTO holdings
      (id,user_id,portfolio_id,instrument_id,quantity_decimal,cost_decimal,status,version,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'active',1,?,?)`).run(holding[0], userId, `portfolio-${userId}`, holding[1], holding[2], holding[3], now, now);
  }
}
