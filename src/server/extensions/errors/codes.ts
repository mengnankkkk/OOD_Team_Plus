export enum ExtensionErrorCode {
  INVALID_REQUEST = "INVALID_REQUEST",
  RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND",
  VERSION_CONFLICT = "VERSION_CONFLICT",
  IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT",
  SQL_SECURITY_VIOLATION = "SQL_SECURITY_VIOLATION",
  QUERY_TIMEOUT = "QUERY_TIMEOUT",
  QUERY_RESULT_EXPIRED = "QUERY_RESULT_EXPIRED",
  QUERY_TRUNCATED = "QUERY_TRUNCATED",
  ARTIFACT_CONTENT_TOO_LARGE = "ARTIFACT_CONTENT_TOO_LARGE",
  ARTIFACT_SANITIZATION_FAILED = "ARTIFACT_SANITIZATION_FAILED",
  SIMULATION_WORKSPACE_ARCHIVED = "SIMULATION_WORKSPACE_ARCHIVED",
  OPTION_ALREADY_EXECUTED = "OPTION_ALREADY_EXECUTED",
  ANALYSIS_NOT_CANCELLABLE = "ANALYSIS_NOT_CANCELLABLE",
  SSRF_BLOCKED = "SSRF_BLOCKED",
  RSS_FEED_UNREACHABLE = "RSS_FEED_UNREACHABLE",
  PANDA_DATA_UNAVAILABLE = "PANDA_DATA_UNAVAILABLE",
  WATCHLIST_LIMIT_EXCEEDED = "WATCHLIST_LIMIT_EXCEEDED",
}

export interface ExtensionError {
  code: ExtensionErrorCode;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
}

export function createExtensionError(
  code: ExtensionErrorCode,
  message: string,
  details?: Record<string, unknown>,
  retryable = false,
): ExtensionError {
  // Never include SQL text, credentials, or secret values in message or details.
  return { code, message, details, retryable };
}
