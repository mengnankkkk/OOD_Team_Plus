import type { AppLocale } from "./config";
import { getMessage } from "./messages";

export function localizedErrorMessage(code: string, locale: AppLocale): string {
  return getMessage(locale, `errors.${code}`);
}
