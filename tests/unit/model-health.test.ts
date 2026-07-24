import { describe, expect, it } from "vitest";

import { probeDeepSeekHealth } from "@/server/advisor/model-health";

describe("DeepSeek health probe", () => {
  it("reports an invalid configured token as an authentication failure", async () => {
    const result = await probeDeepSeekHealth(
      {
        DEEPSEEK_API_KEY: "bad-token",
        DEEPSEEK_API_URL: "https://example.test/v1/chat/completions",
        DEEPSEEK_MODEL: "DeepSeek-Pro",
      },
      async (input) => {
        expect(String(input)).toBe("https://example.test/v1/models");
        return new Response("unauthorized", { status: 401 });
      },
    );

    expect(result).toMatchObject({
      configured: true,
      reachable: false,
      status: "AUTH_FAILED",
      errorCode: "MODEL_AUTH_FAILED",
    });
  });
});
