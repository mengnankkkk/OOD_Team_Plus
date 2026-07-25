import { getDatabase } from "@/server/http/context";

import { syncUserNotifications } from "./proactive-service";

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

export async function runNotificationSweep(): Promise<void> {
  const db = getDatabase();
  const rows = db.prepare(`SELECT DISTINCT user_id FROM (
      SELECT user_id FROM holdings WHERE status='active'
      UNION ALL
      SELECT w.user_id FROM watchlists w JOIN watchlist_items wi ON wi.watchlist_id=w.id
        WHERE w.status='active' AND wi.status='active'
    ) ORDER BY user_id`).all() as Array<{ user_id: string }>;
  db.close();
  for (const row of rows) {
    try {
      await syncUserNotifications(row.user_id, { reason: "scheduled-market-scan" });
    } catch (error) {
      console.error("[notification-scheduler] user sync failed", row.user_id, error instanceof Error ? error.message : String(error));
    }
  }
}
