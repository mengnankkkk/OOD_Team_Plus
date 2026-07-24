import {
  DEFAULT_DEEPSEEK_MODEL,
  getDeepSeekModelConfig,
} from "@/server/chat/environment";

export async function probeDeepSeekHealth(
  environment: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
) {
  const configured = Boolean(environment.DEEPSEEK_API_KEY?.trim());
  const name = environment.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL;
  if (!configured) {
    return {
      provider: "DeepSeek",
      name,
      configured: false,
      reachable: false,
      status: "NOT_CONFIGURED",
      errorCode: "MODEL_NOT_CONFIGURED",
    } as const;
  }

  const config = getDeepSeekModelConfig(environment);
  try {
    const response = await fetchImpl(`${config.url}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) {
      return {
        provider: "DeepSeek",
        name,
        configured: true,
        reachable: true,
        status: "UP",
        errorCode: null,
      } as const;
    }
    const authFailed = response.status === 401 || response.status === 403;
    return {
      provider: "DeepSeek",
      name,
      configured: true,
      reachable: false,
      status: authFailed ? "AUTH_FAILED" : "UNAVAILABLE",
      errorCode: authFailed ? "MODEL_AUTH_FAILED" : "MODEL_UNAVAILABLE",
    } as const;
  } catch (error) {
    return {
      provider: "DeepSeek",
      name,
      configured: true,
      reachable: false,
      status: error instanceof Error && error.name === "TimeoutError" ? "TIMEOUT" : "UNAVAILABLE",
      errorCode: error instanceof Error && error.name === "TimeoutError" ? "MODEL_TIMEOUT" : "MODEL_UNAVAILABLE",
    } as const;
  }
}
