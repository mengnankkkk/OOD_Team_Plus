import type { AppLocale } from "./config";

type DateOptions = Intl.DateTimeFormatOptions & { fallback?: string };

export function formatCny(value: unknown, locale: AppLocale, options: Intl.NumberFormatOptions = {}): string {
  const amount = Number(value);
  if (locale === "en-US") {
    const number = new Intl.NumberFormat(locale, {
      maximumFractionDigits: 0,
      ...options,
      style: "decimal",
    }).format(Number.isFinite(amount) ? amount : 0);
    return `CN¥${number}`;
  }
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "CNY",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
    ...options,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function formatNumber(value: unknown, locale: AppLocale, options: Intl.NumberFormatOptions = {}): string {
  const amount = Number(value);
  return new Intl.NumberFormat(locale, options).format(Number.isFinite(amount) ? amount : 0);
}

export function formatPercent(value: unknown, locale: AppLocale, options: Intl.NumberFormatOptions = {}): string {
  const amount = Number(value);
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1, ...options }).format(Number.isFinite(amount) ? amount : 0);
}

export function formatDate(value: unknown, locale: AppLocale, options: DateOptions = {}): string {
  return formatDateTime(value, locale, { month: "short", day: "numeric", fallback: "—", ...options });
}

export function formatDateTime(value: unknown, locale: AppLocale, options: DateOptions = {}): string {
  const { fallback = "—", ...dateOptions } = options;
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? fallback : new Intl.DateTimeFormat(locale, dateOptions).format(date);
}
