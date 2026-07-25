import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prepareDatabase } from "@/server/db/migration-runner";
import {
  createA2AContext,
  getA2AContext,
  requireCompatibleA2AContext,
} from "./context-service";

const resolvePortfolio = vi.fn();

describe("external A2A context isolation", () => {
  beforeEach(() => {
    const path = `/tmp/a2a-context-${crypto.randomUUID()}.db`;
    vi.stubEnv("DB_PATH", path);
    const db = new Database(path);
    prepareDatabase(db as never, path);
    const now = "2026-07-25T00:00:00.000Z";
    db.prepare("INSERT INTO users (id,display_name,created_at) VALUES ('admin','Admin',?)").run(now);
    for (const clientId of ["client-1", "client-2"]) {
      db.prepare(`INSERT INTO a2a_external_clients
        (id,name,status,capabilities_json,rate_limit_per_minute,created_by_user_id,created_at,updated_at,row_version)
        VALUES (?,?, 'ACTIVE','[]',60,'admin',?,?,1)`).run(clientId, clientId, now, now);
    }
    db.close();
    resolvePortfolio.mockReset().mockResolvedValue({
      cash: "20000",
      holdings: [{
        instrumentId: "AAPL",
        symbol: "AAPL",
        quantity: "10",
        cost: "170",
        price: "205.50",
        priceSource: "PANDADATA",
        dataAsOf: "2026-07-24",
        market: "NASDAQ",
        assetType: "stock",
      }],
      dataAsOf: "2026-07-24",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a non-login execution principal with caller-owned data", async () => {
    const context = await createA2AContext({
      externalClientId: "client-1",
      capabilityId: "scenario_simulation",
      profile: { riskLevel: "BALANCED", horizon: "MEDIUM_TERM", maxDrawdown: "0.15" },
      goals: [{ name: "Retirement", targetAmount: "1000000", horizon: "LONG_TERM", priority: "HIGH" }],
      portfolio: { cash: "20000", holdings: [{ symbol: "AAPL", quantity: "10", cost: "170" }] },
      resolvePortfolio: resolvePortfolio as never,
    });

    const db = new Database(process.env.DB_PATH!);
    const user = db.prepare("SELECT username,password_hash FROM users WHERE id=?")
      .get(context.executionUserId);
    const snapshot = db.prepare("SELECT user_id FROM portfolio_snapshots WHERE id=?")
      .get(context.portfolioSnapshotId);
    db.close();

    expect(user).toEqual({ username: null, password_hash: null });
    expect(snapshot).toEqual({ user_id: context.executionUserId });
    expect(getA2AContext("client-2", context.contextId)).toBeNull();
  });

  it("shares advisory contexts and rejects cross-family reuse", async () => {
    const created = await createA2AContext({
      externalClientId: "client-1",
      capabilityId: "debate_mode",
    });

    expect(requireCompatibleA2AContext(
      "client-1",
      created.contextId,
      "chief_advisor_conversation",
    ).id).toBe(created.contextId);
    expect(() => requireCompatibleA2AContext(
      "client-1",
      created.contextId,
      "scenario_simulation",
    )).toThrowError("CONTEXT_CAPABILITY_MISMATCH");
  });
});
