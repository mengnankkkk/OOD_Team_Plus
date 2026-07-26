import { getDatabase } from "@/server/http/context";

import type { NotificationSeverity } from "./notification-writer";

export type NotificationMode = "important_only" | "daily_digest" | "muted";

export type NotificationPreference = {
  mode: NotificationMode;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
};

type PreferenceRow = {
  mode?: string;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
};

type Db = Pick<ReturnType<typeof getDatabase>, "prepare">;

export function readNotificationPreference(db: Db, userId: string): NotificationPreference {
  const row = db.prepare(`SELECT mode,quiet_hours_start,quiet_hours_end
    FROM notification_preferences WHERE user_id=?`).get(userId) as PreferenceRow | undefined;
  return {
    mode: normalizeMode(row?.mode),
    quietHoursStart: normalizeTime(row?.quiet_hours_start),
    quietHoursEnd: normalizeTime(row?.quiet_hours_end),
  };
}

export function allowsNotification(
  preference: NotificationPreference,
  severity: NotificationSeverity,
): boolean {
  if (preference.mode === "muted") return false;
  if (preference.mode === "important_only") {
    return severity === "important" || severity === "urgent";
  }
  return true;
}

export function allowsScheduledNotificationScan(
  preference: NotificationPreference,
  now = new Date(),
): boolean {
  if (preference.mode === "muted") return false;
  return !isWithinShanghaiQuietHours(preference, now);
}

export function isWithinShanghaiQuietHours(
  preference: Pick<NotificationPreference, "quietHoursStart" | "quietHoursEnd">,
  now = new Date(),
): boolean {
  const start = preference.quietHoursStart;
  const end = preference.quietHoursEnd;
  if (!start || !end || start === end) return false;
  const current = shanghaiMinutes(now);
  const startMinutes = parseMinutes(start);
  const endMinutes = parseMinutes(end);
  if (startMinutes === null || endMinutes === null) return false;
  return startMinutes < endMinutes
    ? current >= startMinutes && current < endMinutes
    : current >= startMinutes || current < endMinutes;
}

function normalizeMode(value: unknown): NotificationMode {
  const mode = String(value ?? "important_only").toLowerCase();
  return mode === "daily_digest" || mode === "muted" ? mode : "important_only";
}

function normalizeTime(value: unknown): string | null {
  const time = value == null ? "" : String(value);
  return parseMinutes(time) === null ? null : time;
}

function parseMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function shanghaiMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}
