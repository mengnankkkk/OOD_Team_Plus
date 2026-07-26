import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getDatabase,
  getRequestContext,
  meta,
} from "@/server/http/context";
import { writeNotificationPreference } from "@/server/extensions/notifications/preference-service";

const QuietTimeSchema = z.string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/u)
  .nullable()
  .optional();

const Schema = z.object({
  mode: z.enum(["IMPORTANT_ONLY", "DAILY_DIGEST", "MUTED"]),
  quietHoursStart: QuietTimeSchema,
  quietHoursEnd: QuietTimeSchema,
}).superRefine((value, context) => {
  const hasStart = value.quietHoursStart != null;
  const hasEnd = value.quietHoursEnd != null;
  if (hasStart !== hasEnd) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: hasStart ? ["quietHoursEnd"] : ["quietHoursStart"],
      message: "Quiet hours start and end must be provided together",
    });
  }
});

export async function GET(req?: NextRequest) {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM notification_preferences WHERE user_id=?")
    .get(getRequestContext(req).userId) as Record<string, unknown> | undefined;
  db.close();
  return NextResponse.json({
    data: row ? format(row) : {
      mode: "IMPORTANT_ONLY",
      quietHoursStart: null,
      quietHoursEnd: null,
      version: 0,
    },
    meta: meta(),
  });
}

export async function PUT(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({
      error: {
        code: "INVALID_REQUEST",
        message: "Invalid preference",
        details: parsed.error.format(),
      },
    }, { status: 400 });
  }

  const userId = getRequestContext(req).userId;
  const header = req.headers.get("If-Match");
  const parsedVersion = Number.parseInt(header?.replaceAll('"', "") ?? "", 10);
  const expectedVersion = Number.isInteger(parsedVersion) ? parsedVersion : null;
  const result = writeNotificationPreference(userId, {
    mode: parsed.data.mode.toLowerCase() as "important_only" | "daily_digest" | "muted",
    quietHoursStart: parsed.data.quietHoursStart ?? null,
    quietHoursEnd: parsed.data.quietHoursEnd ?? null,
    expectedVersion,
  });
  if (!result.ok) {
    return NextResponse.json({
      error: {
        code: "VERSION_CONFLICT",
        message: expectedVersion === null ? "If-Match required" : "Preference was modified",
        details: { currentVersion: result.currentVersion },
      },
    }, { status: 412 });
  }

  return NextResponse.json({
    data: {
      mode: result.preference.mode.toUpperCase(),
      quietHoursStart: result.preference.quietHoursStart,
      quietHoursEnd: result.preference.quietHoursEnd,
      version: result.preference.version,
    },
    meta: meta(),
  });
}

function format(row: Record<string, unknown>) {
  return {
    mode: String(row.mode).toUpperCase(),
    quietHoursStart: row.quiet_hours_start,
    quietHoursEnd: row.quiet_hours_end,
    version: row.row_version,
  };
}
