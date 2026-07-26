import { NextRequest } from "next/server";
import { z } from "zod";

import { PasswordSchema } from "@/server/auth/contracts";
import { authError, clearSessionCookies, localizedJson, localizedNoContent } from "@/server/auth/http";
import { changePassword } from "@/server/auth/service";
import { getRequestContext } from "@/server/http/context";
import { localizedErrorMessage } from "@/i18n/errors";
import { resolveWebLocale } from "@/i18n/resolve-locale";

const Schema = z.object({ currentPassword: PasswordSchema, newPassword: PasswordSchema }).refine(
  (value) => value.currentPassword !== value.newPassword,
  { message: "PASSWORD_SAME_AS_CURRENT", path: ["newPassword"] },
);

export async function PUT(request: NextRequest) {
  const locale = resolveWebLocale({
    cookieLocale: request.cookies.get("mw_locale")?.value,
    acceptLanguage: request.headers.get("accept-language"),
  }).locale;
  const parsed = Schema.safeParse(await request.json().catch(() => null));
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
    const context = getRequestContext(request);
    await changePassword(context.userId, parsed.data.currentPassword, parsed.data.newPassword);
    const response = localizedNoContent(context.locale.locale);
    clearSessionCookies(response);
    return response;
  } catch (error) {
    return authError(error, request);
  }
}
