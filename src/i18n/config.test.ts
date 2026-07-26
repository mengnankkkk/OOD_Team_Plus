import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  SUPPORTED_LOCALES,
  normalizeLocale,
} from "./config";

describe("locale configuration", () => {
  it("normalizes supported locale aliases and rejects unsupported locales", () => {
    expect(SUPPORTED_LOCALES).toEqual(["zh-CN", "en-US"]);
    expect(DEFAULT_LOCALE).toBe("zh-CN");
    expect(LOCALE_COOKIE_NAME).toBe("mw_locale");
    expect(normalizeLocale("zh-Hans-CN")).toBe("zh-CN");
    expect(normalizeLocale("en-GB")).toBe("en-US");
    expect(normalizeLocale("ja-JP")).toBeNull();
  });
});
