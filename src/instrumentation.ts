export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureInitialAdmin } = await import("@/server/auth/service");
  const { startNotificationScheduler } = await import("@/server/extensions/notifications/scheduler");
  await ensureInitialAdmin();
  startNotificationScheduler();
}
