import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { createExtensionError, ExtensionErrorCode } from "@/server/extensions/errors/codes";

import { getPandaContractExcerpt, PANDA_CONTRACTS, resolvePandaSkillRoot, type PandaDataMethod, validatePandaContract } from "./catalog";

export { PANDA_CONTRACTS as ALLOWED_PANDA_METHODS_MAP };
export const ALLOWED_PANDA_METHODS = Object.keys(PANDA_CONTRACTS) as PandaDataMethod[];
export type { PandaDataMethod };

const execFileAsync = promisify(execFile);

export type PandaDataErrorCategory =
  | "PANDADATA_METHOD_NOT_ALLOWED"
  | "PANDADATA_CONTRACT_INVALID"
  | "PANDADATA_SDK_MISSING"
  | "PANDADATA_AUTH_FAILED"
  | "PANDADATA_NETWORK_FAILED"
  | "PANDADATA_STALE"
  | "PANDADATA_UNAVAILABLE";

export interface PandaDataResult {
  data: Array<Record<string, unknown>>;
  method: PandaDataMethod;
  callDurationMs: number;
  dryRunDurationMs: number;
  liveCallDurationMs: number;
  contractValidated: boolean;
  dryRunSucceeded: boolean;
  liveCallSucceeded: boolean;
  fresh: boolean;
  asOfDate: string | null;
  errorCategory: PandaDataErrorCategory | null;
  contractExcerpt: string;
}

export interface PandaDataAdapterOptions {
  pythonPath?: string;
  timeoutMs?: number;
}

export async function callPandaData(
  method: PandaDataMethod,
  params: Record<string, unknown>,
  options: PandaDataAdapterOptions = {},
): Promise<PandaDataResult> {
  if (!ALLOWED_PANDA_METHODS.includes(method)) throw pandaError("PANDADATA_METHOD_NOT_ALLOWED", `Method not whitelisted: ${method}`, false);
  let validated: Record<string, unknown>;
  let contractExcerpt: string;
  try {
    validated = validatePandaContract(method, params);
    contractExcerpt = getPandaContractExcerpt(method);
  } catch (error) {
    throw pandaError("PANDADATA_CONTRACT_INVALID", error instanceof Error ? error.message : "PandaData contract validation failed", false);
  }

  const pythonPath = options.pythonPath ?? process.env.PANDADATA_PYTHON ?? "python";
  const timeoutMs = options.timeoutMs ?? 30_000;
  const scriptPath = path.join(resolvePandaSkillRoot(), "scripts", "call_api.py");
  const args = [scriptPath, "--method", method, "--params", JSON.stringify(validated)];
  const startedAt = Date.now();
  const dryRunStartedAt = Date.now();
  let dryRunDurationMs = 0;
  try {
    await execFileAsync(pythonPath, [...args, "--dry-run"], { env: process.env, timeout: Math.min(timeoutMs, 10_000) });
    dryRunDurationMs = Date.now() - dryRunStartedAt;
  } catch (error) {
    const message = processError(error);
    throw pandaError(classifyError(message), `PandaData dry-run failed: ${message}`, false, {
      phase: "DRY_RUN",
      dryRunSucceeded: false,
      liveCallSucceeded: false,
      durationMs: Date.now() - dryRunStartedAt,
    });
  }

  const liveCallStartedAt = Date.now();
  try {
    const { stdout } = await execFileAsync(pythonPath, [...args, "--no-setup"], { env: process.env, timeout: timeoutMs });
    const rows = parseRows(stdout);
    const asOfDate = newestDate(rows) ?? dateFromParams(validated);
    const fresh = isFresh(asOfDate, method);
    return {
      data: rows,
      method,
      callDurationMs: Date.now() - startedAt,
      dryRunDurationMs,
      liveCallDurationMs: Date.now() - liveCallStartedAt,
      contractValidated: true,
      dryRunSucceeded: true,
      liveCallSucceeded: true,
      fresh,
      asOfDate,
      errorCategory: fresh ? null : "PANDADATA_STALE",
      contractExcerpt,
    };
  } catch (error) {
    const message = processError(error);
    throw pandaError(classifyError(message), `PandaData live call failed: ${message}`, true, {
      phase: "LIVE_CALL",
      dryRunSucceeded: true,
      liveCallSucceeded: false,
      dryRunDurationMs,
      durationMs: Date.now() - liveCallStartedAt,
    });
  }
}

function parseRows(stdout: string): Array<Record<string, unknown>> {
  const payload = JSON.parse(stdout) as { result?: { data?: unknown } };
  const data = payload.result?.data;
  if (!Array.isArray(data)) throw new Error("PandaData returned a non-tabular payload");
  return data.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row));
}

function newestDate(rows: Array<Record<string, unknown>>): string | null {
  return rows.flatMap((row) => [row.date, row.trade_date, row.report_date, row.end_date])
    .map(normalizeDate).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

function dateFromParams(params: Record<string, unknown>): string | null {
  return normalizeDate(params.end_date ?? params.date);
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const digits = String(value).replace(/\D/g, "");
  return digits.length >= 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : null;
}

function isFresh(asOfDate: string | null, method: PandaDataMethod): boolean {
  if (!asOfDate) return false;
  const days = /detail|fina_reports/.test(method) ? 540 : 30;
  const age = Date.now() - Date.parse(`${asOfDate}T00:00:00Z`);
  return age >= 0 && age <= days * 86_400_000;
}

function processError(error: unknown): string {
  if (error && typeof error === "object") {
    const candidate = error as { stderr?: string; message?: string };
    return (candidate.stderr || candidate.message || "PandaData unavailable").trim().slice(0, 500);
  }
  return String(error).slice(0, 500);
}

function classifyError(message: string): PandaDataErrorCategory {
  if (/No module named|compatibility|not installed|import failed/i.test(message)) return "PANDADATA_SDK_MISSING";
  if (/credential|login|auth|password|username|Runtime setup failed/i.test(message)) return "PANDADATA_AUTH_FAILED";
  if (/timeout|network|ECONN|connection|socket|DNS/i.test(message)) return "PANDADATA_NETWORK_FAILED";
  if (/parameter|contract|method not found/i.test(message)) return "PANDADATA_CONTRACT_INVALID";
  return "PANDADATA_UNAVAILABLE";
}

function pandaError(category: PandaDataErrorCategory, message: string, retryable: boolean, details: Record<string, unknown> = {}) {
  return createExtensionError(ExtensionErrorCode.PANDA_DATA_UNAVAILABLE, message, { category, ...details }, retryable);
}
