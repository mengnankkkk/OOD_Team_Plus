import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDatabase } from "@/server/http/context";
import { seedAuthenticatedUser } from "@tests/helpers/auth";

import { getNotificationSyncState, syncUserNotifications } from "./proactive-service";

const dependencyMocks = vi.hoisted(() => ({
  checkWatchlistTargets: vi.fn(),
  refreshPortfolio: vi.fn(),
}));

vi.mock("@/server/extensions/analysis/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/extensions/analysis/service")>();
  return { ...actual, refreshPortfolio: dependencyMocks.refreshPortfolio };
});

vi.mock("@/server/extensions/watchlists/check-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/extensions/watchlists/check-service")>();
  return {
    ...actual,
    checkWatchlistTargets: (...args: Parameters<typeof actual.checkWatchlistTargets>) =>
      dependencyMocks.checkWatchlistTargets(actual.checkWatchlistTargets, ...args),
  };
});

describe("proactive notification sync", () => {
  const userId = "notification-sync-user";

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.stubEnv("DEFAULT_USERNAME", "your_value_here");
    vi.stubEnv("DEFAULT_PASSWORD", "your_value_here");
    vi.stubEnv("JAVA_SERVICE_BASE_URL", "your_value_here");
    dependencyMocks.refreshPortfolio.mockReset().mockResolvedValue(undefined);
    dependencyMocks.checkWatchlistTargets.mockReset().mockImplementation(
      (actual: (...args: unknown[]) => unknown, ...args: unknown[]) => actual(...args),
    );
    seedAuthenticatedUser({ userId, role: "USER" });
    const db = getDatabase();
    db.prepare("DELETE FROM notifications WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM notification_preferences WHERE user_id=?").run(userId);
    db.prepare(`INSERT INTO notification_preferences
      (id,user_id,mode,created_at,updated_at)
      VALUES ('notification-sync-preference',?,'daily_digest',?,?)`)
      .run(userId, "2026-07-25T00:00:00.000Z", "2026-07-25T00:00:00.000Z");
    db.prepare("DELETE FROM notification_sync_states WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM observation_conditions WHERE user_id=? AND id LIKE 'notification-%'").run(userId);
    db.prepare("DELETE FROM rss_item_instruments WHERE id LIKE 'notification-%'").run();
    db.prepare("DELETE FROM rss_items WHERE id LIKE 'notification-%'").run();
    db.prepare("DELETE FROM rss_feeds WHERE id LIKE 'notification-%'").run();
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

  it("does not advance the global market refresh time when a watchlist group partially fails", async () => {
    vi.stubEnv("DEFAULT_USERNAME", "configured");
    vi.stubEnv("DEFAULT_PASSWORD", "configured");
    vi.stubEnv("JAVA_SERVICE_BASE_URL", "https://pandadata.example");
    const db = getDatabase();
    const now = "2026-07-25T00:00:00.000Z";
    db.prepare(`INSERT INTO watchlists
      (id,user_id,name,status,created_at,updated_at)
      VALUES ('notification-partial-list',?,'部分失败','active',?,?)`).run(userId, now, now);
    db.prepare(`INSERT INTO watchlist_items
      (id,watchlist_id,instrument_id,status,added_at,created_at,updated_at)
      VALUES ('notification-partial-item','notification-partial-list','AAPL','active',?,?,?)`)
      .run(now, now, now);
    db.close();
    dependencyMocks.checkWatchlistTargets.mockResolvedValue({
      status: "PARTIAL",
      checkedItemCount: 1,
      itemIds: ["notification-partial-item"],
      evaluatedConditionCount: 0,
      createdNotificationCount: 0,
      marketRefreshAttempted: true,
      marketRefreshSucceeded: false,
      dataAsOf: null,
      errorCode: "PANDADATA_NETWORK_FAILED",
      errorMessage: "部分观察标的行情刷新失败，已继续使用最近一次有效数据。",
    });

    const result = await syncUserNotifications(userId, {
      forceMarketRefresh: true,
      reason: "partial-refresh-test",
    });

    expect(dependencyMocks.refreshPortfolio).toHaveBeenCalledOnce();
    expect(result.marketRefreshSucceeded).toBe(false);
    expect(getNotificationSyncState(userId).lastMarketRefreshAt).toBeNull();
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

  it("creates one watchlist event notification per item and RSS item", async () => {
    const db = getDatabase();
    const now = "2026-07-25T00:00:00.000Z";
    db.prepare(`INSERT INTO watchlists
      (id,user_id,name,status,created_at,updated_at)
      VALUES ('notification-event-list',?,'事件观察','active',?,?)`).run(userId, now, now);
    db.prepare(`INSERT INTO watchlist_items
      (id,watchlist_id,instrument_id,status,added_at,created_at,updated_at)
      VALUES ('notification-event-item','notification-event-list','AAPL','active',?,?,?)`)
      .run(now, now, now);
    db.prepare(`INSERT INTO rss_feeds
      (id,url,title,status,created_by,created_at,updated_at)
      VALUES ('notification-event-feed','https://example.com/event-feed','Event Feed','active',?,?,?)`)
      .run(userId, now, now);
    db.prepare(`INSERT INTO rss_items
      (id,feed_id,guid,title,link,summary,published_at,created_at)
      VALUES ('notification-event-rss','notification-event-feed','event-guid',
        'Apple 发布重大经营更新','https://example.com/apple-event','AAPL 相关事件',?,?)`)
      .run(now, now);
    db.prepare(`INSERT INTO rss_item_instruments
      (id,rss_item_id,instrument_id,match_basis,matched_text,created_at)
      VALUES ('notification-event-link','notification-event-rss','AAPL','symbol_exact','AAPL',?)`)
      .run(now);
    db.close();

    await syncUserNotifications(userId, { forceMarketRefresh: false, reason: "event-test" });
    await syncUserNotifications(userId, { forceMarketRefresh: false, reason: "event-test" });

    const resultDb = getDatabase();
    const rows = resultDb.prepare(`SELECT source_type,source_id,dedupe_key,metadata_json
      FROM notifications
      WHERE user_id=? AND source_type='WATCHLIST_EVENT'`).all(userId) as Array<Record<string, unknown>>;
    resultDb.close();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source_type: "WATCHLIST_EVENT",
      source_id: "notification-event-item",
      dedupe_key: `${userId}:watchlist-event:notification-event-item:notification-event-rss`,
    });
    expect(JSON.parse(String(rows[0].metadata_json))).toMatchObject({
      watchlistItemId: "notification-event-item",
      rssItemId: "notification-event-rss",
      matchBasis: "symbol_exact",
    });
  });

});
