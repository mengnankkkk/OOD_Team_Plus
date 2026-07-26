import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/server/extensions/watchlists/check-service", () => ({
  loadActiveWatchlistTargets: () => [],
  checkWatchlistTargets: dependencyMocks.checkWatchlistTargets,
}));

describe("multi-portfolio proactive refresh", () => {
  const userId = "notification-multi-portfolio-user";
  const now = "2026-07-25T00:00:00.000Z";

  beforeEach(() => {
    vi.stubEnv("DEFAULT_USERNAME", "configured");
    vi.stubEnv("DEFAULT_PASSWORD", "configured");
    vi.stubEnv("JAVA_SERVICE_BASE_URL", "https://pandadata.example");
    dependencyMocks.refreshPortfolio.mockReset().mockResolvedValue(undefined);
    dependencyMocks.checkWatchlistTargets.mockReset().mockResolvedValue({
      status: "SUCCEEDED",
      checkedItemCount: 0,
      itemIds: [],
      evaluatedConditionCount: 0,
      createdNotificationCount: 0,
      marketRefreshAttempted: false,
      marketRefreshSucceeded: false,
      dataAsOf: null,
      errorCode: null,
      errorMessage: null,
    });
    seedAuthenticatedUser({ userId });
    const db = getDatabase();
    db.prepare("UPDATE holdings SET status='deleted' WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM notification_preferences WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM notification_sync_states WHERE user_id=?").run(userId);
    db.prepare(`INSERT INTO notification_preferences
      (id,user_id,mode,created_at,updated_at)
      VALUES ('notification-multi-preference',?,'daily_digest',?,?)`)
      .run(userId, now, now);
    for (const [holdingId, portfolioId, instrumentId] of [
      ["notification-multi-holding-a", "notification-portfolio-a", "AAPL"],
      ["notification-multi-holding-b", "notification-portfolio-b", "MSFT"],
    ]) {
      db.prepare(`INSERT INTO holdings
        (id,user_id,portfolio_id,instrument_id,quantity_decimal,cost_decimal,status,
         created_at,updated_at)
        VALUES (?,?,?,?,'1','100','active',?,?)`)
        .run(holdingId, userId, portfolioId, instrumentId, now, now);
    }
    db.close();
  });

  it("refreshes every active portfolio for the user", async () => {
    await syncUserNotifications(userId, {
      forceMarketRefresh: true,
      reason: "multi-portfolio-refresh-test",
    });

    expect(dependencyMocks.refreshPortfolio.mock.calls
      .map((call) => call[1])
      .sort()).toEqual([
      "notification-portfolio-a",
      "notification-portfolio-b",
    ]);
  });
});
