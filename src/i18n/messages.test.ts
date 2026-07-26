import { describe, expect, it } from "vitest";

import { flattenMessageKeys, loadMessages } from "./messages";

describe("message catalogs", () => {
  it("keeps identical leaf keys and ICU parameters in both locales", async () => {
    const [zh, en] = await Promise.all([loadMessages("zh-CN"), loadMessages("en-US")]);
    expect(flattenMessageKeys(zh)).toEqual(flattenMessageKeys(en));
    expect(zh.common.app).toBe("Money Whisperer");
    expect(en.auth.login.title).toBe("Return to your financial workspace");
    expect(en.errors.UNAUTHENTICATED).toContain("Authentication");
  });
});
