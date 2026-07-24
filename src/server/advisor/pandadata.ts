import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  getPandadataMethodContract,
  isPandadataMethodAllowed,
  pandadataMethodCatalog,
  pandadataMethodWhitelist,
  type PandadataMethodDescriptor,
} from "@/server/advisor/pandadata-catalog";
import {
  classifyLiveCallError,
  classifyProbeError,
  dateFromParams,
  isFreshMarketDate,
  latestRows,
  newestDateFromRows,
  parsePandadataJson,
  resolvePythonBinary,
  summarizeLiveCallError,
  summarizeProbeError,
} from "@/server/advisor/pandadata-runtime";
import { pandadataChildProcessEnvironment } from "@/server/advisor/pandadata-environment";

export {
  getPandadataMethodContract,
  isPandadataMethodAllowed,
  pandadataMethodCatalog,
  pandadataMethodWhitelist,
};
export type { PandadataMethodDescriptor };

const execFileAsync = promisify(execFile);

export type PandadataProbe = {
  method: string;
  ok: boolean;
  contractValidated: boolean;
  runtimeConfigured: boolean;
  liveCallSucceeded: boolean;
  liveDataFresh: boolean;
  mode: "dry_run" | "live";
  summary: string;
  rows?: number;
  columns?: string[];
  data?: Array<Record<string, unknown>>;
  asOfDate?: string;
  requestedParams?: Record<string, unknown>;
  errorCode?:
    | "PANDADATA_METHOD_NOT_ALLOWED"
    | "PANDADATA_SKILL_MISSING"
    | "PANDADATA_SDK_MISSING"
    | "PANDADATA_AUTH_FAILED"
    | "PANDADATA_UNAVAILABLE"
    | "PANDADATA_STALE_DATA";
};

export class PandadataAdapter {
  constructor(
    private readonly skillRoot = process.env.PANDADATA_SKILL_ROOT?.trim() ||
      path.join(process.cwd(), ".codex/skills/pandadata-api"),
  ) {}

  methods() {
    return pandadataMethodWhitelist;
  }

  catalog(query?: string) {
    const normalizedQuery = query?.trim().toLowerCase();
    return pandadataMethodCatalog
      .filter((method) => method.sdkExported && (!normalizedQuery ||
        `${method.name} ${method.category} ${method.section} ${method.summary}`.toLowerCase().includes(normalizedQuery)))
      .map((method) => ({ ...method }));
  }

  async probe(method: string, params: Record<string, unknown>): Promise<PandadataProbe> {
    if (!isPandadataMethodAllowed(method)) {
      return baseProbe(method, params, {
        errorCode: "PANDADATA_METHOD_NOT_ALLOWED",
        summary: "Pandadata 方法不在 P0 白名单内。",
      });
    }

    const runner = path.join(this.skillRoot, "scripts/call_api.py");
    try {
      await access(runner);
    } catch {
      return baseProbe(method, params, {
        errorCode: "PANDADATA_SKILL_MISSING",
        summary: "未找到复制的 pandadata-api Skill 运行器。",
      });
    }

    try {
      await execFileAsync(
        await resolvePythonBinary(),
        [runner, "--method", method, "--params", JSON.stringify(params), "--dry-run"],
        { timeout: 8_000, env: pandadataChildProcessEnvironment() },
      );
      return {
        ...baseProbe(method, params),
        ok: true,
        contractValidated: true,
        runtimeConfigured: true,
        summary: `${method} 已通过 SDK 方法与参数 dry-run 校验；尚未取得真实行情数据。`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return baseProbe(method, params, {
        errorCode: classifyProbeError(message),
        summary: summarizeProbeError(message),
      });
    }
  }

  async fetch(method: string, params: Record<string, unknown>): Promise<PandadataProbe> {
    const contract = await this.probe(method, params);
    if (!contract.ok) return contract;

    const runner = path.join(this.skillRoot, "scripts/call_api.py");
    try {
      const { stdout } = await execFileAsync(
        await resolvePythonBinary(),
        [runner, "--method", method, "--params", JSON.stringify(params), "--no-setup"],
        { timeout: 15_000, env: pandadataChildProcessEnvironment() },
      );
      const parsed = parsePandadataJson(stdout);
      const asOfDate = newestDateFromRows(parsed.rows) ?? dateFromParams(params);
      const liveDataFresh = isFreshMarketDate(asOfDate, method);
      return {
        ...contract,
        ok: liveDataFresh,
        contractValidated: true,
        runtimeConfigured: true,
        liveCallSucceeded: true,
        liveDataFresh,
        mode: "live",
        rows: parsed.rowCount,
        columns: parsed.columns,
        data: latestRows(parsed.rows),
        asOfDate,
        errorCode: liveDataFresh ? undefined : "PANDADATA_STALE_DATA",
        summary: liveDataFresh
          ? `${method} 真实取数成功，返回 ${parsed.rowCount} 行，最新日期 ${asOfDate}。`
          : `${method} 真实取数成功但数据不满足新鲜度要求，最新日期 ${asOfDate ?? "未知"}。`,
      };
    } catch (error) {
      return {
        ...contract,
        ok: false,
        liveCallSucceeded: false,
        liveDataFresh: false,
        mode: "live",
        errorCode: classifyLiveCallError(error),
        summary: summarizeLiveCallError(error),
      };
    }
  }
}

export function hasActionablePandadata(result: PandadataProbe | null | undefined) {
  return Boolean(
    result?.contractValidated &&
      result.runtimeConfigured &&
      result.liveCallSucceeded &&
      result.liveDataFresh,
  );
}

function baseProbe(
  method: string,
  params: Record<string, unknown>,
  patch: Partial<PandadataProbe> = {},
): PandadataProbe {
  return {
    method,
    ok: false,
    contractValidated: false,
    runtimeConfigured: false,
    liveCallSucceeded: false,
    liveDataFresh: false,
    mode: "dry_run",
    requestedParams: params,
    summary: "Pandadata 方法尚未通过契约校验。",
    ...patch,
  };
}
