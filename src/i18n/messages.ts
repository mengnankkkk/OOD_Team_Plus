import type { AppLocale } from "./config";

import enUS from "./messages/en-US/index.json";
import zhCN from "./messages/zh-CN/index.json";

export type Messages = typeof zhCN;

const catalogs = {
  "zh-CN": zhCN,
  "en-US": enUS,
} satisfies Record<AppLocale, Messages>;

export async function loadMessages(locale: AppLocale): Promise<Messages> {
  return catalogs[locale];
}

export function flattenMessageKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, nested]) => flattenMessageKeys(nested, prefix ? `${prefix}.${key}` : key));
}

export function getMessage(locale: AppLocale, path: string): string {
  const value = path.split(".").reduce<unknown>((current, key) => (
    current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined
  ), catalogs[locale]);
  return typeof value === "string" ? value : path;
}
