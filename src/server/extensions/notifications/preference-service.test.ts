import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/http/context";
import { seedAuthenticatedUser } from "@tests/helpers/auth";

import { writeNotificationPreference } from "./preference-service";

describe("notification preference writes", () => {
  const userId = "preference-write-user";

  beforeEach(() => {
    seedAuthenticatedUser({ userId });
    const db = getDatabase();
    db.prepare("DELETE FROM notification_preferences WHERE user_id=?").run(userId);
    db.close();
  });

  it("allows only one update for the same expected version", () => {
    expect(writeNotificationPreference(userId, {
      mode: "daily_digest",
      quietHoursStart: null,
      quietHoursEnd: null,
      expectedVersion: null,
    })).toMatchObject({ ok: true, preference: { version: 1 } });

    expect(writeNotificationPreference(userId, {
      mode: "muted",
      quietHoursStart: null,
      quietHoursEnd: null,
      expectedVersion: 1,
    })).toMatchObject({ ok: true, preference: { version: 2 } });

    expect(writeNotificationPreference(userId, {
      mode: "important_only",
      quietHoursStart: null,
      quietHoursEnd: null,
      expectedVersion: 1,
    })).toEqual({ ok: false, currentVersion: 2 });
  });
});
