import { spawn } from "node:child_process";
import path from "node:path";

import { createExtensionError, ExtensionErrorCode } from "@/server/extensions/errors/codes";

export const ALLOWED_PANDA_METHODS = [
  "get_stock_daily",
  "get_fund_daily",
  "get_index_daily",
  "get_stock_info",
  "get_fund_info",
  "get_market_snapshot",
] as const;

export type PandaDataMethod = (typeof ALLOWED_PANDA_METHODS)[number];

export interface PandaDataResult {
  data: unknown;
  method: string;
  callDurationMs: number;
}

export interface PandaDataAdapterOptions {
  pythonPath?: string;
  timeoutMs?: number;
}

interface PandaDataErrorOutput {
  error?: string;
  retryable?: boolean;
}

export async function callPandaData(
  method: PandaDataMethod,
  params: Record<string, unknown>,
  options: PandaDataAdapterOptions = {},
): Promise<PandaDataResult> {
  if (!(ALLOWED_PANDA_METHODS as readonly string[]).includes(method)) {
    throw createExtensionError(
      ExtensionErrorCode.PANDA_DATA_UNAVAILABLE,
      `Method not whitelisted: ${method}`,
    );
  }

  const pythonPath = options.pythonPath ?? process.env.PANDADATA_PYTHON ?? "python";
  const timeoutMs = options.timeoutMs ?? 30_000;
  const scriptPath = path.resolve(process.cwd(), "scripts", "call_api.py");
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, [scriptPath, method, JSON.stringify(params)], {
      env: process.env,
      timeout: timeoutMs,
    });
    let stdout = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", () => undefined);

    child.once("close", (code) => {
      if (code !== 0) {
        let output: PandaDataErrorOutput = {};
        try {
          output = JSON.parse(stdout.trim()) as PandaDataErrorOutput;
        } catch {
          // Keep the public error generic when the bridge emits invalid output.
        }
        reject(
          createExtensionError(
            ExtensionErrorCode.PANDA_DATA_UNAVAILABLE,
            output.error ?? "PandaData call failed",
            undefined,
            output.retryable ?? !output.error,
          ),
        );
        return;
      }

      try {
        resolve({
          data: JSON.parse(stdout.trim()) as unknown,
          method,
          callDurationMs: Date.now() - startedAt,
        });
      } catch {
        reject(
          createExtensionError(
            ExtensionErrorCode.PANDA_DATA_UNAVAILABLE,
            "PandaData returned invalid JSON",
            undefined,
            true,
          ),
        );
      }
    });

    child.once("error", () => {
      reject(
        createExtensionError(
          ExtensionErrorCode.PANDA_DATA_UNAVAILABLE,
          "Failed to start PandaData process",
          undefined,
          true,
        ),
      );
    });
  });
}
