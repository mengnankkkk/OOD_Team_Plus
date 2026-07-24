import type { PandadataProbe } from "@/server/advisor/pandadata";

const dateKeys = [
  "trade_date", "date", "cal_date", "end_date", "datetime", "info_date",
  "period_end_date", "report_date", "change_date", "event_date",
];

export function parsePandadataJson(stdout: string) {
  const payload = JSON.parse(stdout) as {
    result?: { rows?: number; columns?: string[]; data?: unknown };
  };
  const data = normalizeRows(payload.result?.data);
  return {
    rows: data,
    rowCount: payload.result?.rows ?? data.length,
    columns: payload.result?.columns ?? Object.keys(data[0] ?? {}),
  };
}

export function newestDateFromRows(rows: Array<Record<string, unknown>>) {
  const candidates = rows.map(rowDate).filter((value): value is string => Boolean(value));
  return candidates.sort().at(-1);
}

export function latestRows(rows: Array<Record<string, unknown>>, limit = 120) {
  const dated = rows.map((row, index) => ({ row, index, date: rowDate(row) }));
  if (!dated.some((item) => item.date)) return rows.slice(-limit);
  return dated
    .sort((left, right) => {
      if (!left.date || !right.date) return left.index - right.index;
      return left.date.localeCompare(right.date) || left.index - right.index;
    })
    .slice(-limit)
    .map((item) => item.row);
}

export function dateFromParams(params: Record<string, unknown>) {
  for (const key of ["end_date", "date", "info_date"]) {
    const value = normalizeDate(params[key]);
    if (value) return value;
  }
  return new Date().toISOString().slice(0, 10);
}

export async function resolvePythonBinary() {
  return process.env.PANDADATA_PYTHON?.trim() || "python3";
}

export function isFreshMarketDate(asOfDate: string | undefined, method: string) {
  if (!asOfDate) return false;
  const ageMs = Date.now() - new Date(`${asOfDate}T00:00:00Z`).getTime();
  return ageMs >= 0 && ageMs <= freshnessWindowDays(method) * 24 * 60 * 60 * 1_000;
}

export function classifyLiveCallError(error: unknown): PandadataProbe["errorCode"] {
  const message = error instanceof Error ? error.message : String(error);
  if (/credential|login|auth|password|username|Runtime setup failed/i.test(message)) {
    return "PANDADATA_AUTH_FAILED";
  }
  if (/No module named|compatibility|panda_data|duckdb|parquet.*未安装/i.test(message)) {
    return "PANDADATA_SDK_MISSING";
  }
  return "PANDADATA_UNAVAILABLE";
}

export function summarizeLiveCallError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/duckdb|parquet.*未安装/i.test(message)) {
    return "Pandadata 返回了 Parquet 数据，但当前 Python 环境缺少 DuckDB 依赖，请安装 duckdb。";
  }
  if (/No module named/i.test(message)) return "当前环境未安装 panda_data，无法执行真实 Pandadata 调用。";
  if (/Runtime setup failed|credential|login|auth|password|username/i.test(message)) {
    return "Pandadata SDK 已通过契约校验，但缺少或无法使用真实数据凭证。";
  }
  return "Pandadata 真实取数失败，不能把 dry-run 结果当作实时行情。";
}

export function classifyProbeError(message: string): PandadataProbe["errorCode"] {
  if (/No module named|compatibility|Unsupported panda_data|panda_data import failed/i.test(message)) {
    return "PANDADATA_SDK_MISSING";
  }
  if (/unknown parameter|missing required|Dry-run parameter validation/i.test(message)) {
    return "PANDADATA_METHOD_NOT_ALLOWED";
  }
  return "PANDADATA_UNAVAILABLE";
}

export function summarizeProbeError(message: string) {
  if (/No module named|panda_data import failed/i.test(message)) {
    return "当前环境未安装 panda_data，无法执行真实 Pandadata 调用。";
  }
  if (/unknown parameter|missing required|Dry-run parameter validation/i.test(message)) {
    return "Pandadata 方法已找到，但请求参数不符合 Skill 文档契约。";
  }
  return "Pandadata dry-run 失败，请检查 SDK 版本、方法或参数契约。";
}

function normalizeRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.map((item) => (
      item && typeof item === "object" && !Array.isArray(item)
        ? item as Record<string, unknown>
        : { value: item }
    ));
  }
  if (value && typeof value === "object") return [{ value }];
  return value == null ? [] : [{ value }];
}

function normalizeDate(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const digits = String(value).replace(/\D/g, "");
  if (digits.length < 8) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function rowDate(row: Record<string, unknown>) {
  return dateKeys
    .map((key) => normalizeDate(row[key]))
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
}

function freshnessWindowDays(method: string) {
  if (/^(get_stock|index|fund|hk|us|future|option)_(rt_|daily|min|spot|static)/.test(method)) return 30;
  if (/fina|audit|forecast|statement|operating|mktfin|pv_(indicator|metric)|consensus|estimate/.test(method)) return 540;
  if (/macro|calendar/.test(method)) return 540;
  if (/dividend|split|repurchase|restricted|pledge|shareholder|holder|top_holders|block_trade|share_float|status|event|activity|meeting|insider/.test(method)) return 365;
  return 90;
}
