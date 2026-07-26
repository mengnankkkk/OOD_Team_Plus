import { NextRequest } from "next/server";

import { clearSessionCookies, localizedNoContent } from "@/server/auth/http";
import { revokeSession } from "@/server/auth/service";
import { resolveWebLocale } from "@/i18n/resolve-locale";

export async function POST(request: NextRequest) {
  revokeSession(request.cookies.get("mw_session")?.value);
  const locale = resolveWebLocale({
    cookieLocale: request.cookies.get("mw_locale")?.value,
    acceptLanguage: request.headers.get("accept-language"),
  }).locale;
  const response = localizedNoContent(locale);
  clearSessionCookies(response);
  return response;
}
