import { cleanupExpiredA2AContexts } from "./cleanup";

const SCHEDULER_INTERVAL_MS = 60 * 60 * 1_000;
const START_DELAY_MS = 30_000;
let started = false;

export function startA2ACleanupScheduler(): void {
  if (started) return;
  started = true;
  const timer = setTimeout(() => {
    cleanupExpiredA2AContexts();
    const interval = setInterval(() => cleanupExpiredA2AContexts(), SCHEDULER_INTERVAL_MS);
    interval.unref?.();
  }, START_DELAY_MS);
  timer.unref?.();
}
