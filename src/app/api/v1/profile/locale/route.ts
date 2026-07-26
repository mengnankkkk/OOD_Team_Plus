import { NextRequest } from "next/server";
import { z } from "zod";

import { authError, localizedJson, setLocaleCookie } from "@/server/auth/http";
import { getDatabase, getRequestContext, meta } from "@/server/http/context";
import { normalizeLocale } from "@/i18n/config";
import { localizedErrorMessage } from "@/i18n/errors";

const Schema = z.object({ locale: z.string().min(1) });

export async function PATCH(request: NextRequest) {
  try {
    const context = getRequestContext(request);
    const parsed = Schema.safeParse(await request.json().catch(() => null));
    const locale = parsed.success ? normalizeLocale(parsed.data.locale) : null;
    if (!locale) {
      return localizedJson({
        error: {
          code: "VALIDATION_ERROR",
          message: localizedErrorMessage("VALIDATION_ERROR", context.locale.locale),
        },
        meta: meta(),
      }, 422, context.locale.locale);
    }
    const db = getDatabase();
    db.prepare("UPDATE users SET preferred_locale=?, updated_at=?, row_version=row_version+1 WHERE id=?")
      .run(locale, new Date().toISOString(), context.userId);
    db.close();
    const response = localizedJson({ data: { locale }, meta: meta() }, 200, locale);
    setLocaleCookie(response, locale, request);
    return response;
  } catch (error) {
    return authError(error, request);
  }
}
