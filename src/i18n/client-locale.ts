import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, normalizeLocale, type AppLocale } from "./config";

export function getClientLocale(): AppLocale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const value = document.cookie.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LOCALE_COOKIE_NAME}=`))
    ?.slice(`${LOCALE_COOKIE_NAME}=`.length);
  return normalizeLocale(value ? decodeURIComponent(value) : null) ?? DEFAULT_LOCALE;
}
