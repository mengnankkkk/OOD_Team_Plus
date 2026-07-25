export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureInitialAdmin } = await import("@/server/auth/service");
  const { startNotificationScheduler } = await import("@/server/extensions/notifications/scheduler");
  const { ensureBootstrapA2AClient } = await import("@/server/a2a/bootstrap-client");
  const { startA2ACleanupScheduler } = await import("@/server/a2a/cleanup-scheduler");
  await ensureInitialAdmin();
  ensureBootstrapA2AClient();
  startNotificationScheduler();
  startA2ACleanupScheduler();
}
