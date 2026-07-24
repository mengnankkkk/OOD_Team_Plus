export const DEFAULT_PANDADATA_BASE_URL = "http://pandadata.pandaaiquant.com";

type Environment = Record<string, string | undefined>;

export function getPandadataEnvironment(
  environment: Environment = process.env,
) {
  const username = firstValue(
    environment.PANDADATA_USERNAME,
    environment.DEFAULT_USERNAME,
  );
  const password = firstValue(
    environment.PANDADATA_PASSWORD,
    environment.DEFAULT_PASSWORD,
  );
  const baseUrl = firstValue(
    environment.PANDADATA_BASE_URL,
    environment.JAVA_SERVICE_BASE_URL,
  ) || DEFAULT_PANDADATA_BASE_URL;
  const usernameValid = /^86\d{11}$/.test(username);

  return {
    username,
    password,
    baseUrl,
    credentialsConfigured:
      usernameValid && Boolean(password) && isHttpUrl(baseUrl),
    usernameValid,
  };
}

export function pandadataChildProcessEnvironment(
  environment: Environment = process.env,
): NodeJS.ProcessEnv {
  const config = getPandadataEnvironment(environment);
  return {
    ...environment,
    NODE_ENV: nodeEnvironment(environment.NODE_ENV),
    DEFAULT_USERNAME: config.username,
    DEFAULT_PASSWORD: config.password,
    JAVA_SERVICE_BASE_URL: config.baseUrl,
  };
}

function nodeEnvironment(value: string | undefined): NodeJS.ProcessEnv["NODE_ENV"] {
  if (value === "production" || value === "test") return value;
  return "development";
}

function firstValue(...values: Array<string | undefined>) {
  return values.map((value) => value?.trim() ?? "").find(Boolean) ?? "";
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
