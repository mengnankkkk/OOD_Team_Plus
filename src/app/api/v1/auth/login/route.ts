import { NextRequest } from "next/server";
import { z } from "zod";

import { PasswordSchema, UsernameSchema } from "@/server/auth/contracts";
import { authError, localizedJson, requestIp, setLocaleCookie, setSessionCookies } from "@/server/auth/http";
import { localizedErrorMessage } from "@/i18n/errors";
import { normalizeLocale } from "@/i18n/config";
import { resolveWebLocale } from "@/i18n/resolve-locale";
import { authenticateUser, createSession, enforceFixedWindowRateLimit, setPreferredLocale } from "@/server/auth/service";
import { meta } from "@/server/http/context";

const Schema = z.object({ username: UsernameSchema, password: PasswordSchema, locale: z.string().optional() });

export async function POST(request: NextRequest) {
  const requestLocale = resolveWebLocale({
    cookieLocale: request.cookies.get("mw_locale")?.value,
    acceptLanguage: request.headers.get("accept-language"),
  }).locale;
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return localizedJson({ error: { code: "VALIDATION_ERROR", message: localizedErrorMessage("VALIDATION_ERROR", requestLocale), details: parsed.error.format() } }, 422, requestLocale);
  const requestedLocale = parsed.data.locale === undefined ? null : normalizeLocale(parsed.data.locale);
  if (parsed.data.locale !== undefined && !requestedLocale) {
    return localizedJson({ error: { code: "VALIDATION_ERROR", message: localizedErrorMessage("VALIDATION_ERROR", requestLocale) } }, 422, requestLocale);
  }
  try {
    enforceFixedWindowRateLimit({ scope: "auth_login", subject: `${requestIp(request) ?? "unknown"}:${parsed.data.username}`, limit: 10, windowSeconds: 60 });
    const authenticatedUser = await authenticateUser(parsed.data.username, parsed.data.password);
    const user = requestedLocale ? setPreferredLocale(authenticatedUser.id, requestedLocale) : authenticatedUser;
    const session = createSession(user, { userAgent: request.headers.get("user-agent"), ip: requestIp(request) });
    const locale = resolveWebLocale({
      accountLocale: user.preferredLocale,
      cookieLocale: request.cookies.get("mw_locale")?.value,
      acceptLanguage: request.headers.get("accept-language"),
    }).locale;
    const response = localizedJson({ data: { user, csrfToken: session.csrfToken, expiresAt: session.expiresAt }, meta: meta() }, 200, locale);
    setSessionCookies(response, session, request);
    setLocaleCookie(response, locale, request);
    return response;
  } catch (error) {
    return authError(error, request);
  }
}
