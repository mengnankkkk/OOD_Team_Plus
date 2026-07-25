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
});
