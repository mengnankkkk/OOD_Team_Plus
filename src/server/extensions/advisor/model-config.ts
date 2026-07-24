export const DEFAULT_DEEPSEEK_MODEL = "DeepSeek-Pro";
export const DEFAULT_DEEPSEEK_API_URL = "https://ai-model-api.matrix-studio.top/v1/chat/completions";

export function normalizeOpenAIEndpoint(endpoint: string): string {
  const parsed = new URL(endpoint);
  const path = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = path.endsWith("/chat/completions") ? path.slice(0, -"/chat/completions".length) || "/" : path || "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function getDeepSeekModelConfig(environment: Record<string, string | undefined> = process.env) {
  return {
    id: `deepseek/${environment.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL}` as `${string}/${string}`,
    url: normalizeOpenAIEndpoint(environment.DEEPSEEK_API_URL?.trim() || DEFAULT_DEEPSEEK_API_URL),
    apiKey: environment.DEEPSEEK_API_KEY?.trim(),
  };
}
