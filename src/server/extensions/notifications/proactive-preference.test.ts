import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDatabase } from "@/server/http/context";
import { seedAuthenticatedUser } from "@tests/helpers/auth";

import {
  getNotificationSyncState,
  syncUserNotifications,
} from "./proactive-service";

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

describe("proactive notification preferences", () => {
  const userId = "notification-preference-user";
  const now = "2026-07-25T00:00:00.000Z";

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
    db.prepare("DELETE FROM notification_sync_states WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM rss_item_instruments WHERE id LIKE 'notification-preference-%'").run();
    db.prepare("DELETE FROM rss_items WHERE id LIKE 'notification-preference-%'").run();
    db.prepare("DELETE FROM rss_feeds WHERE id LIKE 'notification-preference-%'").run();
    db.prepare("DELETE FROM watchlist_items WHERE id LIKE 'notification-preference-%'").run();
    db.prepare("DELETE FROM watchlists WHERE id LIKE 'notification-preference-%'").run();
    db.prepare(`INSERT INTO notification_preferences
      (id,user_id,mode,created_at,updated_at)
      VALUES ('notification-preference-row',?,'daily_digest',?,?)`)
      .run(userId, now, now);
    db.prepare("UPDATE portfolio_snapshots SET cash_decimal='0' WHERE user_id=?").run(userId);
    db.close();
  });

  it("skips proactive work entirely when notifications are muted", async () => {
    const db = getDatabase();
    db.prepare("UPDATE notification_preferences SET mode='muted' WHERE user_id=?").run(userId);
    db.prepare(`INSERT INTO notification_sync_states
      (user_id,status,last_attempt_at,error_code,error_message,created_at,updated_at)
      VALUES (?,'failed',?,'OLD_FAILURE','旧失败',?,?)`)
      .run(userId, now, now, now);
    db.close();

    const result = await syncUserNotifications(userId, {
      forceMarketRefresh: true,
      reason: "muted-test",
    });

    expect(result).toMatchObject({
      status: "succeeded",
      createdCount: 0,
      evaluatedConditionCount: 0,
      marketRefreshAttempted: false,
      marketRefreshSucceeded: false,
      errorCode: null,
      skippedReason: "MUTED",
    });
    expect(dependencyMocks.refreshPortfolio).not.toHaveBeenCalled();
    expect(dependencyMocks.checkWatchlistTargets).not.toHaveBeenCalled();
    expect(getNotificationSyncState(userId)).toMatchObject({
      status: "idle",
      errorCode: null,
      errorMessage: null,
    });
  });

  it("suppresses information and attention alerts in important-only mode", async () => {
    const db = getDatabase();
    db.prepare("UPDATE notification_preferences SET mode='important_only' WHERE user_id=?").run(userId);
    db.prepare(`INSERT INTO watchlists
      (id,user_id,name,status,created_at,updated_at)
      VALUES ('notification-preference-list',?,'偏好测试','active',?,?)`).run(userId, now, now);
    db.prepare(`INSERT INTO watchlist_items
      (id,watchlist_id,instrument_id,status,added_at,created_at,updated_at)
      VALUES ('notification-preference-item','notification-preference-list','AAPL','active',?,?,?)`)
      .run(now, now, now);
    db.prepare(`INSERT INTO rss_feeds
      (id,url,title,status,created_by,created_at,updated_at)
      VALUES ('notification-preference-feed','https://example.com/preference','Preference',
        'active',?,?,?)`).run(userId, now, now);
    db.prepare(`INSERT INTO rss_items
      (id,feed_id,guid,title,published_at,created_at)
      VALUES ('notification-preference-rss','notification-preference-feed','preference-guid',
        'Apple 事件',?,?)`).run(now, now);
    db.prepare(`INSERT INTO rss_item_instruments
      (id,rss_item_id,instrument_id,match_basis,matched_text,created_at)
      VALUES ('notification-preference-link','notification-preference-rss','AAPL',
        'symbol_exact','AAPL',?)`).run(now);
    db.close();

    await syncUserNotifications(userId, {
      forceMarketRefresh: false,
      reason: "important-only-test",
    });

    const resultDb = getDatabase();
    const severities = resultDb.prepare("SELECT DISTINCT severity FROM notifications WHERE user_id=?")
      .all(userId) as Array<{ severity: string }>;
    resultDb.close();
    expect(severities.length).toBeGreaterThan(0);
    expect(severities.every((row) => row.severity === "important" || row.severity === "urgent"))
      .toBe(true);
  });
});
