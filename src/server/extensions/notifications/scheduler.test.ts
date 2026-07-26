import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDatabase } from "@/server/http/context";
import { seedAuthenticatedUser } from "@tests/helpers/auth";

const syncUserNotifications = vi.hoisted(() => vi.fn());

vi.mock("./proactive-service", () => ({
  syncUserNotifications,
}));

import { runNotificationSweep } from "./scheduler";

describe("notification scheduler preferences", () => {
  const allowedUser = "scheduler-allowed-user";
  const mutedUser = "scheduler-muted-user";
  const quietUser = "scheduler-quiet-user";

  beforeEach(() => {
    syncUserNotifications.mockReset().mockResolvedValue(undefined);
    for (const userId of [allowedUser, mutedUser, quietUser]) {
      seedAuthenticatedUser({ userId, role: "USER" });
    }
    const db = getDatabase();
    db.prepare("DELETE FROM notification_preferences WHERE user_id IN (?,?,?)")
      .run(allowedUser, mutedUser, quietUser);
    const now = "2026-07-25T00:00:00.000Z";
    db.prepare(`INSERT INTO notification_preferences
      (id,user_id,mode,quiet_hours_start,quiet_hours_end,created_at,updated_at)
      VALUES
      ('scheduler-pref-allowed',?,'daily_digest',NULL,NULL,?,?),
      ('scheduler-pref-muted',?,'muted',NULL,NULL,?,?),
      ('scheduler-pref-quiet',?,'daily_digest','08:00','10:00',?,?)`)
      .run(allowedUser, now, now, mutedUser, now, now, quietUser, now, now);
    db.close();
  });

  it("skips muted users and users currently inside Shanghai quiet hours", async () => {
    await runNotificationSweep(new Date("2026-07-25T01:00:00.000Z"));

    expect(syncUserNotifications).toHaveBeenCalledTimes(1);
    expect(syncUserNotifications).toHaveBeenCalledWith(allowedUser, {
      reason: "scheduled-market-scan",
    });
  });
});
