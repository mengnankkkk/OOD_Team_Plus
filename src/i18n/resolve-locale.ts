import {
  DEFAULT_LOCALE,
  normalizeLocale,
  type AppLocale,
} from "./config";

export type LocaleSource = "a2a-parameter" | "account" | "cookie" | "accept-language" | "default";

export type LocaleContext = {
  locale: AppLocale;
  source: LocaleSource;
  acceptLanguage: string | null;
};

type WebLocaleInput = {
  accountLocale?: string | null;
  cookieLocale?: string | null;
  acceptLanguage?: string | null;
};

type A2ALocaleInput = {
  explicitLocale?: string | null;
  acceptLanguage?: string | null;
};

export function resolveWebLocale(input: WebLocaleInput): LocaleContext {
  const account = normalizeLocale(input.accountLocale);
  if (account) return { locale: account, source: "account", acceptLanguage: input.acceptLanguage ?? null };
  const cookie = normalizeLocale(input.cookieLocale);
  if (cookie) return { locale: cookie, source: "cookie", acceptLanguage: input.acceptLanguage ?? null };
  const header = localeFromAcceptLanguage(input.acceptLanguage);
  if (header) return { locale: header, source: "accept-language", acceptLanguage: input.acceptLanguage ?? null };
  return { locale: DEFAULT_LOCALE, source: "default", acceptLanguage: input.acceptLanguage ?? null };
}

export function resolveA2ALocale(input: A2ALocaleInput): LocaleContext {
  const explicit = normalizeLocale(input.explicitLocale);
  if (explicit) return { locale: explicit, source: "a2a-parameter", acceptLanguage: input.acceptLanguage ?? null };
  const header = localeFromAcceptLanguage(input.acceptLanguage);
  if (header) return { locale: header, source: "accept-language", acceptLanguage: input.acceptLanguage ?? null };
  return { locale: DEFAULT_LOCALE, source: "default", acceptLanguage: input.acceptLanguage ?? null };
}

function localeFromAcceptLanguage(value: string | null | undefined): AppLocale | null {
  if (!value) return null;
  const candidates = value.split(",")
    .map((part, index) => {
      const [tag, ...parameters] = part.trim().split(";");
      const qParameter = parameters.find((parameter) => parameter.trim().startsWith("q="));
      const quality = qParameter ? Number.parseFloat(qParameter.trim().slice(2)) : 1;
      return { tag, quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((item) => item.quality > 0)
    .sort((left, right) => right.quality - left.quality || left.index - right.index);
  for (const candidate of candidates) {
    const locale = normalizeLocale(candidate.tag);
    if (locale) return locale;
  }
  return null;
}
