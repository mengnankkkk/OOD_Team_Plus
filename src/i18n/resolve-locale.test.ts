import { describe, expect, it } from "vitest";

import { resolveA2ALocale, resolveWebLocale } from "./resolve-locale";

describe("locale resolution", () => {
  it("uses account preference before cookie, header, and default", () => {
    expect(resolveWebLocale({
      accountLocale: "en-US",
      cookieLocale: "zh-CN",
      acceptLanguage: "zh-CN",
    })).toMatchObject({ locale: "en-US", source: "account" });
  });

  it("uses the cookie for anonymous requests before Accept-Language", () => {
    expect(resolveWebLocale({
      cookieLocale: "en-US",
      acceptLanguage: "zh-CN",
    })).toMatchObject({ locale: "en-US", source: "cookie" });
  });

  it("respects Accept-Language q-values and falls back to zh-CN", () => {
    expect(resolveWebLocale({
      acceptLanguage: "ja-JP;q=1, en-GB;q=0.8, zh-CN;q=0.5",
    })).toMatchObject({ locale: "en-US", source: "accept-language" });
    expect(resolveWebLocale({ acceptLanguage: "ja-JP" })).toMatchObject({ locale: "zh-CN", source: "default" });
  });

  it("uses an explicit A2A locale before Accept-Language", () => {
    expect(resolveA2ALocale({ explicitLocale: "zh-CN", acceptLanguage: "en-US" }))
      .toMatchObject({ locale: "zh-CN", source: "a2a-parameter" });
  });
});
