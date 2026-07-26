import { NextRequest } from "next/server";
import { z } from "zod";

import { authError, localizedJson } from "@/server/auth/http";
import { createId, getDatabase, getRequestContext, isoNow, meta, parseJson } from "@/server/http/context";
import { localizedErrorMessage } from "@/i18n/errors";
import { resolveWebLocale } from "@/i18n/resolve-locale";

const ProfileSchema = z.object({ riskLevel: z.enum(["R1", "R2", "R3", "R4", "R5", "CONSERVATIVE", "BALANCED", "AGGRESSIVE"]).nullable().optional(), investmentAmount: z.string().optional(), targetAmount: z.string().optional(), targetDate: z.string().nullable().optional(), horizon: z.enum(["SHORT", "MEDIUM", "LONG"]).nullable().optional(), priority: z.enum(["STOCK", "SECTOR", "INDEX"]).nullable().optional(), maxDrawdown: z.string().nullable().optional(), preferences: z.record(z.string(), z.unknown()).optional() });

export async function GET(req: NextRequest) {
  try {
    const context = getRequestContext(req);
    const db = getDatabase();
    const userId = context.userId;
    const row = db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(userId) as Record<string, unknown> | undefined;
    const goalCount = Number((db.prepare("SELECT COUNT(*) AS count FROM goals WHERE user_id = ? AND status = 'active'").get(userId) as { count?: number } | undefined)?.count ?? 0);
    db.close();
    return localizedJson({ data: row ? format(row, goalCount) : { status: "DRAFT", version: 0, riskLevel: null, preferences: {}, hasGoal: false, onboardingCompleted: false }, meta: meta() }, 200, context.locale.locale);
  } catch (error) {
    return authError(error, req);
  }
}

export async function PATCH(req: NextRequest) {
  let db: ReturnType<typeof getDatabase> | null = null;
  try {
    const parsed = ProfileSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      const locale = resolveWebLocale({
        cookieLocale: req.cookies.get("mw_locale")?.value,
        acceptLanguage: req.headers.get("accept-language"),
      }).locale;
      return localizedJson({ error: { code: "VALIDATION_ERROR", message: localizedErrorMessage("VALIDATION_ERROR", locale), details: parsed.error.format() } }, 422, locale);
    }
    const context = getRequestContext(req);
    const { userId } = context;
    db = getDatabase();
    const now = isoNow();
    const currentVersion = req.headers.get("If-Match");
    const existing = db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(userId) as Record<string, unknown> | undefined;
    if (existing && !currentVersion) {
      db.close();
      db = null;
      return localizedJson({ error: { code: "VERSION_CONFLICT", message: localizedErrorMessage("VERSION_CONFLICT", context.locale.locale), details: { currentVersion: existing.version } } }, 412, context.locale.locale);
    }
    if (existing && Number(currentVersion?.replaceAll('"', "")) !== existing.version) {
      db.close();
      db = null;
      return localizedJson({ error: { code: "VERSION_CONFLICT", message: localizedErrorMessage("VERSION_CONFLICT", context.locale.locale), details: { currentVersion: existing.version } } }, 412, context.locale.locale);
    }
    const previousPreferences = existing ? JSON.parse(String(existing.preferences_json ?? "{}")) as Record<string, unknown> : {};
    const preferences = { ...previousPreferences, ...(parsed.data.preferences ?? {}) };
    const keep = (value: unknown, previous: unknown) => value === undefined ? previous ?? null : value;
    db.prepare(`INSERT INTO user_profiles (id, user_id, risk_level, investment_amount_decimal, target_amount_decimal, target_date, horizon, priority, max_drawdown_decimal, preferences_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET risk_level=excluded.risk_level, investment_amount_decimal=excluded.investment_amount_decimal, target_amount_decimal=excluded.target_amount_decimal, target_date=excluded.target_date, horizon=excluded.horizon, priority=excluded.priority, max_drawdown_decimal=excluded.max_drawdown_decimal, preferences_json=excluded.preferences_json, version=user_profiles.version+1, updated_at=excluded.updated_at`)
      .run(createId("profile"), userId, keep(parsed.data.riskLevel, existing?.risk_level), keep(parsed.data.investmentAmount, existing?.investment_amount_decimal), keep(parsed.data.targetAmount, existing?.target_amount_decimal), keep(parsed.data.targetDate, existing?.target_date), keep(parsed.data.horizon, existing?.horizon), keep(parsed.data.priority, existing?.priority), keep(parsed.data.maxDrawdown, existing?.max_drawdown_decimal), JSON.stringify(preferences), now, now);
    const row = db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(userId) as Record<string, unknown>;
    const goalCount = Number((db.prepare("SELECT COUNT(*) AS count FROM goals WHERE user_id = ? AND status = 'active'").get(userId) as { count?: number } | undefined)?.count ?? 0);
    db.close();
    db = null;
    return localizedJson({ data: format(row, goalCount), meta: meta() }, 200, context.locale.locale);
  } catch (error) {
    db?.close();
    return authError(error, req);
  }
}

function format(row: Record<string, unknown>, goalCount = 0) {
  const status = String(row.status).toUpperCase();
  const preferences = parseJson<Record<string, unknown>>(String(row.preferences_json ?? "{}"), {});
  const hasSuitabilityAnswers = Boolean(
    row.risk_level
    && row.investment_amount_decimal
    && row.horizon
    && row.max_drawdown_decimal
    && preferences.instrumentPreference != null
    && preferences.instrumentPreference !== ""
    && preferences.nearTermUse != null,
  );
  return {
    id: row.id,
    status,
    riskLevel: row.risk_level,
    investmentAmount: row.investment_amount_decimal,
    targetAmount: row.target_amount_decimal,
    targetDate: row.target_date,
    horizon: row.horizon,
    priority: row.priority,
    maxDrawdown: row.max_drawdown_decimal,
    preferences,
    version: row.version,
    updatedAt: row.updated_at,
    hasGoal: goalCount > 0,
    onboardingCompleted: (status === "COMPLETE" || status === "COMPLETED") && goalCount > 0 && hasSuitabilityAnswers,
  };
}
