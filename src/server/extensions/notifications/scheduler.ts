import { getDatabase } from "@/server/http/context";

import { syncUserNotifications } from "./proactive-service";
import {
  allowsScheduledNotificationScan,
  type NotificationPreference,
} from "./preference-policy";

const SCHEDULER_INTERVAL_MS = 60 * 60 * 1_000;
const START_DELAY_MS = 15_000;
const schedulerKey = Symbol.for("money-whisperer.notification-scheduler");

type SchedulerRegistry = typeof globalThis & { [schedulerKey]?: NodeJS.Timeout };

export function startNotificationScheduler(): void {
  if (process.env.NODE_ENV === "test") return;
  const registry = globalThis as SchedulerRegistry;
  if (registry[schedulerKey]) return;

  const run = () => void runNotificationSweep();
  const startupTimer = setTimeout(run, START_DELAY_MS);
  startupTimer.unref();
  const interval = setInterval(run, SCHEDULER_INTERVAL_MS);
  interval.unref();
  registry[schedulerKey] = interval;
}

export async function runNotificationSweep(now = new Date()): Promise<void> {
  const db = getDatabase();
  const rows = db.prepare(`SELECT candidates.user_id,p.mode,p.quiet_hours_start,p.quiet_hours_end
    FROM (SELECT DISTINCT user_id FROM (
      SELECT user_id FROM holdings WHERE status='active'
      UNION ALL
      SELECT w.user_id FROM watchlists w JOIN watchlist_items wi ON wi.watchlist_id=w.id
        WHERE w.status='active' AND wi.status='active'
    )) candidates
    LEFT JOIN notification_preferences p ON p.user_id=candidates.user_id
    ORDER BY candidates.user_id`).all() as Array<{
      user_id: string;
      mode?: string;
      quiet_hours_start?: string | null;
      quiet_hours_end?: string | null;
    }>;
  db.close();
  for (const row of rows) {
    const preference: NotificationPreference = {
      mode: row.mode === "daily_digest" || row.mode === "muted" ? row.mode : "important_only",
      quietHoursStart: row.quiet_hours_start ?? null,
      quietHoursEnd: row.quiet_hours_end ?? null,
    };
    if (!allowsScheduledNotificationScan(preference, now)) continue;
    try {
      await syncUserNotifications(row.user_id, { reason: "scheduled-market-scan" });
    } catch (error) {
      console.error("[notification-scheduler] user sync failed", row.user_id, error instanceof Error ? error.message : String(error));
    }
  }
}
