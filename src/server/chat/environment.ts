import { z } from "zod";

const serverEnvironmentSchema = z.object({
  DEEPSEEK_API_KEY: z.string().trim().min(1),
});

export const DEFAULT_DEEPSEEK_MODEL = "DeepSeek-Pro";
export const DEFAULT_DEEPSEEK_API_URL =
  "https://ai-model-api.matrix-studio.top/v1/chat/completions";

export function normalizeOpenAIEndpoint(endpoint: string) {
  const parsed = new URL(endpoint);
  const path = parsed.pathname.replace(/\/+$/, "");
  const basePath = path.endsWith("/chat/completions")
    ? path.slice(0, -"/chat/completions".length)
    : path;

  parsed.pathname = basePath || "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function getDeepSeekModelConfig(
  environment: Record<string, string | undefined> = process.env,
) {
  return {
    id: `deepseek/${environment.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL}` as `${string}/${string}`,
    url: normalizeOpenAIEndpoint(
      environment.DEEPSEEK_API_URL?.trim() || DEFAULT_DEEPSEEK_API_URL,
    ),
    apiKey: environment.DEEPSEEK_API_KEY?.trim(),
  };
}

export class MissingEnvironmentError extends Error {
  readonly code = "MISSING_DEEPSEEK_API_KEY";

  constructor() {
    super("未检测到 DEEPSEEK_API_KEY，请通过安全的环境变量方式注入后重试。");
    this.name = "MissingEnvironmentError";
  }
}

export function requireDeepSeekApiKey(
  environment: Record<string, string | undefined> = process.env,
) {
  const result = serverEnvironmentSchema.safeParse(environment);

  if (!result.success) {
    throw new MissingEnvironmentError();
  }

  return result.data.DEEPSEEK_API_KEY;
}
