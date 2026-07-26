import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDatabase } from "@/server/http/context";
import { seedAuthenticatedUser } from "@tests/helpers/auth";

import { syncUserNotifications } from "./proactive-service";

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

describe("partial proactive rule evaluation", () => {
  const userId = "notification-partial-rule-user";
  const now = "2026-07-25T00:00:00.000Z";

  afterEach(() => {
    const db = getDatabase();
    db.exec("DROP TRIGGER IF EXISTS notification_global_rule_failure");
    db.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.stubEnv("DEFAULT_USERNAME", "configured");
    vi.stubEnv("DEFAULT_PASSWORD", "configured");
    vi.stubEnv("JAVA_SERVICE_BASE_URL", "https://pandadata.example");
    dependencyMocks.refreshPortfolio.mockReset().mockResolvedValue(undefined);
    dependencyMocks.checkWatchlistTargets.mockReset().mockImplementation(
      (actual: (...args: unknown[]) => unknown, ...args: unknown[]) => actual(...args),
    );
    seedAuthenticatedUser({ userId, role: "USER" });

    const db = getDatabase();
    db.prepare("DELETE FROM notifications WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM notification_preferences WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM notification_sync_states WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM observation_conditions WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM market_snapshots WHERE id='notification-global-market'").run();
    db.prepare(`INSERT INTO notification_preferences
      (id,user_id,mode,created_at,updated_at)
      VALUES ('notification-partial-rule-preference',?,'daily_digest',?,?)`)
      .run(userId, now, now);
    db.close();
  });

  it("reports a partial sync when one non-watchlist rule fails", async () => {
    const db = getDatabase();
    for (const id of ["notification-global-a", "notification-global-b"]) {
      db.prepare(`INSERT INTO observation_conditions
        (id,user_id,instrument_id,condition_type,threshold_decimal,status,severity,
         last_observed_decimal,config_json,created_at,updated_at)
        VALUES (?,?,'SPY','PRICE_ABOVE','150','active','important','149','{}',?,?)`)
        .run(id, userId, now, now);
    }
    db.prepare(`INSERT INTO market_snapshots
      (id,instrument_id,data_source_id,snapshot_type,as_of,trading_date,market_timezone,
       freshness_status,quality_status,raw_payload_json,created_at)
      VALUES ('notification-global-market','SPY','source-pandadata-api',
        'daily','2026-07-25T08:00:00.000Z','2026-07-25','America/New_York',
        'fresh','valid','{"date":"2026-07-25","close":151}',
        '2026-07-25T08:00:00.000Z')`).run();
    db.exec(`CREATE TRIGGER notification_global_rule_failure
      BEFORE INSERT ON notifications
      WHEN NEW.condition_id = 'notification-global-b'
      BEGIN
        SELECT RAISE(ABORT, 'forced proactive rule failure');
      END`);
    db.close();

    const result = await syncUserNotifications(userId, {
      forceMarketRefresh: false,
      reason: "partial-rule-test",
    });

    expect(result).toMatchObject({
      status: "partial",
      evaluatedConditionCount: 1,
      errorCode: "NOTIFICATION_EVALUATION_PARTIAL",
    });
  });
});
