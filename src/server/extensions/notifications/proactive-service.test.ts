import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDatabase } from "@/server/http/context";
import { seedAuthenticatedUser } from "@tests/helpers/auth";

import { getNotificationSyncState, syncUserNotifications } from "./proactive-service";

describe("proactive notification sync", () => {
  const userId = "notification-sync-user";

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.stubEnv("DEFAULT_USERNAME", "your_value_here");
    vi.stubEnv("DEFAULT_PASSWORD", "your_value_here");
    vi.stubEnv("JAVA_SERVICE_BASE_URL", "your_value_here");
    seedAuthenticatedUser({ userId, role: "USER" });
    const db = getDatabase();
    db.prepare("DELETE FROM notifications WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM notification_sync_states WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM observation_conditions WHERE user_id=? AND id LIKE 'notification-%'").run(userId);
    db.prepare("DELETE FROM watchlist_items WHERE id LIKE 'notification-%'").run();
    db.prepare("DELETE FROM watchlists WHERE user_id=? AND id LIKE 'notification-%'").run(userId);
    db.prepare("DELETE FROM market_snapshots WHERE id LIKE 'notification-%'").run();
    db.prepare("UPDATE portfolio_snapshots SET cash_decimal='0' WHERE user_id=?").run(userId);
    db.close();
  });

  it("creates deterministic portfolio alerts and deduplicates repeated scans", async () => {
    const first = await syncUserNotifications(userId, { reason: "test-scan" });
    const second = await syncUserNotifications(userId, { reason: "test-scan" });

    expect(first.status).toBe("partial");
    expect(first.createdCount).toBeGreaterThan(0);
    expect(first.errorCode).toBe("PANDADATA_NOT_CONFIGURED");
    expect(second.createdCount).toBe(0);

    const db = getDatabase();
    const rows = db.prepare("SELECT severity,source_type,dedupe_key,metadata_json FROM notifications WHERE user_id=? ORDER BY created_at").all(userId) as Array<Record<string, unknown>>;
    db.close();
    expect(rows.some((row) => row.source_type === "CONCENTRATION_RISK" && row.severity === "urgent")).toBe(true);
    expect(rows.every((row) => typeof row.dedupe_key === "string" && String(row.dedupe_key).includes(userId))).toBe(true);
    expect(rows.every((row) => JSON.parse(String(row.metadata_json)))).toBeTruthy();
  });

  it("persists a public sync state without secret values", async () => {
    await syncUserNotifications(userId, { reason: "state-test" });
    const state = getNotificationSyncState(userId);

    expect(state.status).toBe("partial");
    expect(state.errorCode).toBe("PANDADATA_NOT_CONFIGURED");
    expect(state.errorMessage).toContain("最近一次有效快照");
    expect(JSON.stringify(state)).not.toContain("your_value_here");
  });

  it("uses the structured drawdown rule instead of a stale legacy threshold", async () => {
    const db = getDatabase();
    const now = "2026-07-25T00:00:00.000Z";
    db.prepare(`INSERT INTO watchlists
      (id,user_id,name,status,created_at,updated_at)
      VALUES ('notification-rule-list',?,'规则来源','active',?,?)`).run(userId, now, now);
    db.prepare(`INSERT INTO watchlist_items
      (id,watchlist_id,instrument_id,drawdown_threshold_bps,status,added_at,created_at,updated_at)
      VALUES ('notification-rule-item','notification-rule-list','AAPL',5000,'active',?,?,?)`)
      .run(now, now, now);
    db.prepare(`INSERT INTO observation_conditions
      (id,user_id,instrument_id,condition_type,threshold_decimal,status,watchlist_item_id,
       severity,window_days,config_json,created_at,updated_at)
      VALUES ('notification-rule-condition',?,'AAPL','DRAWDOWN_REACH','0.10','active',
        'notification-rule-item','attention',20,'{}',?,?)`).run(userId, now, now);
    for (const [id, date, close] of [
      ["notification-rule-market-1", "2026-07-24", 100],
      ["notification-rule-market-2", "2026-07-25", 80],
    ]) {
      db.prepare(`INSERT INTO market_snapshots
        (id,instrument_id,data_source_id,snapshot_type,as_of,trading_date,market_timezone,
         freshness_status,quality_status,raw_payload_json,created_at)
        VALUES (?,'AAPL','source-pandadata-api','daily',?,?,'America/New_York',
          'fresh','valid',?,?)`)
        .run(id, `${date}T00:00:00.000Z`, date, JSON.stringify({ date, close }), `${date}T00:00:00.000Z`);
    }
    db.close();

    await syncUserNotifications(userId, { forceMarketRefresh: false, reason: "rule-source-test" });

    const resultDb = getDatabase();
    const alert = resultDb.prepare(`SELECT source_type FROM notifications
      WHERE user_id=? AND source_id='notification-rule-item' AND source_type='WATCHLIST_DRAWDOWN'`).get(userId);
    resultDb.close();
    expect(alert).toEqual({ source_type: "WATCHLIST_DRAWDOWN" });
  });

  it("does not revive a legacy drawdown alert after the structured rule is deleted", async () => {
    const db = getDatabase();
    const now = "2026-07-25T00:00:00.000Z";
    db.prepare(`INSERT INTO watchlists
      (id,user_id,name,status,created_at,updated_at)
      VALUES ('notification-deleted-list',?,'已删除规则','active',?,?)`).run(userId, now, now);
    db.prepare(`INSERT INTO watchlist_items
      (id,watchlist_id,instrument_id,drawdown_threshold_bps,status,added_at,created_at,updated_at)
      VALUES ('notification-deleted-item','notification-deleted-list','AAPL',1000,'active',?,?,?)`)
      .run(now, now, now);
    db.prepare(`INSERT INTO observation_conditions
      (id,user_id,instrument_id,condition_type,threshold_decimal,status,watchlist_item_id,
       severity,window_days,config_json,created_at,updated_at)
      VALUES ('notification-deleted-condition',?,'AAPL','DRAWDOWN_REACH','0.10','deleted',
        'notification-deleted-item','attention',20,'{}',?,?)`).run(userId, now, now);
    for (const [id, date, close] of [
      ["notification-deleted-market-1", "2026-07-24", 100],
      ["notification-deleted-market-2", "2026-07-25", 80],
    ]) {
      db.prepare(`INSERT INTO market_snapshots
        (id,instrument_id,data_source_id,snapshot_type,as_of,trading_date,market_timezone,
         freshness_status,quality_status,raw_payload_json,created_at)
        VALUES (?,'AAPL','source-pandadata-api','daily',?,?,'America/New_York',
          'fresh','valid',?,?)`)
        .run(id, `${date}T00:00:00.000Z`, date, JSON.stringify({ date, close }), `${date}T00:00:00.000Z`);
    }
    db.close();

    await syncUserNotifications(userId, { forceMarketRefresh: false, reason: "deleted-rule-test" });

    const resultDb = getDatabase();
    const alert = resultDb.prepare(`SELECT source_type FROM notifications
      WHERE user_id=? AND source_id='notification-deleted-item' AND source_type='WATCHLIST_DRAWDOWN'`).get(userId);
    resultDb.close();
    expect(alert).toBeUndefined();
  });
});
