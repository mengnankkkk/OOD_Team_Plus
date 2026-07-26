import { createId, getDatabase, isoNow } from "@/server/http/context";

import type { NotificationMode } from "./preference-policy";

type Preference = {
  mode: NotificationMode;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  version: number;
};

type WriteInput = {
  mode: NotificationMode;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  expectedVersion: number | null;
};

export type PreferenceWriteResult =
  | { ok: true; preference: Preference }
  | { ok: false; currentVersion: number };

export function writeNotificationPreference(
  userId: string,
  input: WriteInput,
): PreferenceWriteResult {
  const db = getDatabase();
  try {
    const now = isoNow();
    if (input.expectedVersion !== null) {
      const updated = db.prepare(`UPDATE notification_preferences
        SET mode=?,quiet_hours_start=?,quiet_hours_end=?,updated_at=?,row_version=row_version+1
        WHERE user_id=? AND row_version=?`)
        .run(
          input.mode,
          input.quietHoursStart,
          input.quietHoursEnd,
          now,
          userId,
          input.expectedVersion,
        );
      if (updated.changes) return { ok: true, preference: readPreference(db, userId) };
    }

    if (input.expectedVersion === null || input.expectedVersion === 0) {
      const inserted = db.prepare(`INSERT INTO notification_preferences
        (id,user_id,mode,quiet_hours_start,quiet_hours_end,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id) DO NOTHING`)
        .run(
          createId("pref"),
          userId,
          input.mode,
          input.quietHoursStart,
          input.quietHoursEnd,
          now,
          now,
        );
      if (inserted.changes) return { ok: true, preference: readPreference(db, userId) };
    }

    const current = db.prepare(`SELECT row_version FROM notification_preferences
      WHERE user_id=?`).get(userId) as { row_version?: number } | undefined;
    return { ok: false, currentVersion: Number(current?.row_version ?? 0) };
  } finally {
    db.close();
  }
}

function readPreference(
  db: ReturnType<typeof getDatabase>,
  userId: string,
): Preference {
  const row = db.prepare(`SELECT mode,quiet_hours_start,quiet_hours_end,row_version
    FROM notification_preferences WHERE user_id=?`).get(userId) as {
      mode: NotificationMode;
      quiet_hours_start: string | null;
      quiet_hours_end: string | null;
      row_version: number;
    };
  return {
    mode: row.mode,
    quietHoursStart: row.quiet_hours_start,
    quietHoursEnd: row.quiet_hours_end,
    version: row.row_version,
  };
}
