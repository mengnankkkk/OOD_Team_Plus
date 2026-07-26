import { NextRequest } from "next/server";
import { z } from "zod";

import {
  getDatabase,
  getRequestContext,
  meta,
} from "@/server/http/context";
import { writeNotificationPreference } from "@/server/extensions/notifications/preference-service";
import { authError, localizedJson } from "@/server/auth/http";
import { localizedErrorMessage } from "@/i18n/errors";
import { resolveWebLocale } from "@/i18n/resolve-locale";

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
  try {
    const context = getRequestContext(req);
    const db = getDatabase();
    const row = db.prepare("SELECT * FROM notification_preferences WHERE user_id=?")
      .get(context.userId) as Record<string, unknown> | undefined;
    db.close();
    return localizedJson({
      data: row ? format(row) : {
        mode: "IMPORTANT_ONLY",
        quietHoursStart: null,
        quietHoursEnd: null,
        version: 0,
      },
      meta: meta(),
    }, 200, context.locale.locale);
  } catch (error) {
    return authError(error, req);
  }
}

export async function PUT(req: NextRequest) {
  const locale = resolveWebLocale({
    cookieLocale: req.cookies.get("mw_locale")?.value,
    acceptLanguage: req.headers.get("accept-language"),
  }).locale;
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return localizedJson({
      error: {
        code: "VALIDATION_ERROR",
        message: localizedErrorMessage("VALIDATION_ERROR", locale),
        details: parsed.error.format(),
      },
    }, 422, locale);
  }

  try {
    const context = getRequestContext(req);
    const header = req.headers.get("If-Match");
    const parsedVersion = Number.parseInt(header?.replaceAll('"', "") ?? "", 10);
    const expectedVersion = Number.isInteger(parsedVersion) ? parsedVersion : null;
    const result = writeNotificationPreference(context.userId, {
      mode: parsed.data.mode.toLowerCase() as "important_only" | "daily_digest" | "muted",
      quietHoursStart: parsed.data.quietHoursStart ?? null,
      quietHoursEnd: parsed.data.quietHoursEnd ?? null,
      expectedVersion,
    });
    if (!result.ok) {
      return localizedJson({
        error: {
          code: "VERSION_CONFLICT",
          message: localizedErrorMessage("VERSION_CONFLICT", context.locale.locale),
          details: { currentVersion: result.currentVersion },
        },
      }, 412, context.locale.locale);
    }

    return localizedJson({
      data: {
        mode: result.preference.mode.toUpperCase(),
        quietHoursStart: result.preference.quietHoursStart,
        quietHoursEnd: result.preference.quietHoursEnd,
      version: result.preference.version,
      },
      meta: meta(),
    }, 200, context.locale.locale);
  } catch (error) {
    return authError(error, req);
  }
}

function format(row: Record<string, unknown>) {
  return {
    mode: String(row.mode).toUpperCase(),
    quietHoursStart: row.quiet_hours_start,
    quietHoursEnd: row.quiet_hours_end,
    version: row.row_version,
  };
}
