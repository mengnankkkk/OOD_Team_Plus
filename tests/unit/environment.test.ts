import { describe, expect, it } from "vitest";

import {
  DEFAULT_DEEPSEEK_API_URL,
  DEFAULT_DEEPSEEK_MODEL,
  MissingEnvironmentError,
  getDeepSeekModelConfig,
  normalizeOpenAIEndpoint,
  requireDeepSeekApiKey,
} from "@/server/chat/environment";

describe("requireDeepSeekApiKey", () => {
  it("accepts a key from the process environment shape", () => {
    expect(requireDeepSeekApiKey({ DEEPSEEK_API_KEY: "test-key" })).toBe(
      "test-key",
    );
  });

  it("fails clearly when the key is missing", () => {
    expect(() => requireDeepSeekApiKey({})).toThrow(MissingEnvironmentError);
  });

  it("normalizes a complete chat endpoint to an OpenAI-compatible base URL", () => {
    expect(normalizeOpenAIEndpoint(DEFAULT_DEEPSEEK_API_URL)).toBe(
      "https://ai-model-api.matrix-studio.top/v1",
    );
  });

  it("builds the configured model without exposing the key in the id", () => {
    const config = getDeepSeekModelConfig({ DEEPSEEK_API_KEY: "test-key" });
    expect(config.id).toBe(`deepseek/${DEFAULT_DEEPSEEK_MODEL}`);
    expect(config.url).toBe("https://ai-model-api.matrix-studio.top/v1");
    expect(config.apiKey).toBe("test-key");
  });
});
