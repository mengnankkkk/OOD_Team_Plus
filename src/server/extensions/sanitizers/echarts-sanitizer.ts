const MAX_ECHARTS_BYTES = 512 * 1024; // 512 KiB

const ALLOWED_TYPES = new Set(["line", "bar", "pie", "scatter", "radar", "treemap"]);

export interface SanitizeResult {
  valid: boolean;
  sanitized?: unknown;
  errors: string[];
}

function containsFunctionString(value: unknown): boolean {
  if (typeof value === "string") {
    return /function\s*\(|=>\s*\{|new\s+Function/.test(value);
  }

  if (Array.isArray(value)) {
    return value.some(containsFunctionString);
  }

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(containsFunctionString);
  }

  return false;
}

export function sanitizeEChartsOption(rawOption: unknown): SanitizeResult {
  const jsonStr = JSON.stringify(rawOption) ?? "";
  if (Buffer.byteLength(jsonStr, "utf8") > MAX_ECHARTS_BYTES) {
    return { valid: false, errors: ["ECharts option exceeds 512 KiB limit"] };
  }

  if (!rawOption || typeof rawOption !== "object" || Array.isArray(rawOption)) {
    return { valid: false, errors: ["ECharts option must be a non-null object"] };
  }

  const option = rawOption as Record<string, unknown>;

  if (Array.isArray(option.series)) {
    for (const series of option.series as Record<string, unknown>[]) {
      if (series.type && !ALLOWED_TYPES.has(String(series.type))) {
        return {
          valid: false,
          errors: [`Chart type not allowed: ${String(series.type)}. Allowed: ${[...ALLOWED_TYPES].join(", ")}`],
        };
      }
    }
  }

  if (containsFunctionString(rawOption)) {
    return { valid: false, errors: ["Function strings are not allowed in ECharts options"] };
  }

  if (/https?:\/\/[^"']*\.js["']/.test(jsonStr)) {
    return { valid: false, errors: ["External script links are not allowed"] };
  }

  return { valid: true, sanitized: rawOption, errors: [] };
}

export { ALLOWED_TYPES, MAX_ECHARTS_BYTES };
