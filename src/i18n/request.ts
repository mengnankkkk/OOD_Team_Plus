import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { createHash } from "node:crypto";

import { LOCALE_COOKIE_NAME } from "./config";
import { loadMessages } from "./messages";
import { resolveWebLocale } from "./resolve-locale";
import { getDbClient } from "@/server/db/client";

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const accountLocale = readAccountLocale(cookieStore.get("mw_session")?.value);
  const locale = resolveWebLocale({
    accountLocale,
    cookieLocale: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage: headerStore.get("accept-language"),
  });
  return { locale: locale.locale, messages: await loadMessages(locale.locale) };
});

function readAccountLocale(sessionToken: string | undefined): string | null {
  if (!sessionToken) return null;
  const db = getDbClient();
  try {
    const row = db.prepare(`SELECT u.preferred_locale
      FROM api_sessions s
      JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND s.revoked_at IS NULL
        AND u.status='ACTIVE' AND u.deleted_at IS NULL
      LIMIT 1`).get(
      createHash("sha256").update(sessionToken).digest("hex"),
      new Date().toISOString(),
    ) as { preferred_locale?: string | null } | undefined;
    return row?.preferred_locale ?? null;
  } finally {
    db.close();
  }
}
