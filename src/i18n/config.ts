export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export type ContentLocale = AppLocale | "und";

export const DEFAULT_LOCALE: AppLocale = "zh-CN";
export const LOCALE_COOKIE_NAME = "mw_locale";

export function normalizeLocale(value: string | null | undefined): AppLocale | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh-hans" || normalized === "zh-hans-cn") return "zh-CN";
  if (normalized === "en" || normalized === "en-us" || normalized === "en-gb") return "en-US";
  return null;
}
