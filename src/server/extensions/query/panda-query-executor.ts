import { createHash } from "node:crypto";

import Decimal from "decimal.js";

import type { SqliteDb } from "@/server/db/client.runtime";
import { callPandaData, type PandaDataResult } from "@/server/extensions/pandadata/adapter";

import type { QueryExecutionResult } from "./executor";
import type { PandaQuerySource } from "./market-catalog";

type PandaCaller = typeof callPandaData;

export interface PandaSourceExecution {
  source: PandaQuerySource;
  result: PandaDataResult;
  toolCallId: string;
  skillRunId: string;
  marketSnapshotIds: string[];
}

export async function executePandaSources(options: {
  sources: PandaQuerySource[];
  agentRunId: string;
  localRows: Record<string, unknown>[];
  db: SqliteDb;
  call?: PandaCaller;
}): Promise<PandaSourceExecution[]> {
  const call = options.call ?? callPandaData;
  const executions: PandaSourceExecution[] = [];
  for (const source of options.sources) {
    const resolvedSource = resolveSymbols(source, options.localRows);
    if (!Array.isArray(resolvedSource.parameters.symbol) || resolvedSource.parameters.symbol.length === 0) {
      throw new Error(`Market QueryPlan requires an explicit symbol or a local symbol join: ${source.dataset}`);
    }
    executions.push(await executeOne(resolvedSource, options.agentRunId, options.db, call));
  }
  return executions;
}

export function combineQueryResults(
  localResult: QueryExecutionResult | null,
  pandaExecutions: PandaSourceExecution[],
  limit: number,
): QueryExecutionResult {
  const marketRows = pandaExecutions.flatMap(({ source, result }) => result.data.map((row) => ({
    ...row,
    source_dataset: source.dataset,
    source_method: source.method,
    data_freshness: result.fresh ? "FRESH" : "STALE",
  })));
  let rows: Record<string, unknown>[];
  if (!localResult) {
    rows = marketRows;
  } else if (!marketRows.length) {
    rows = localResult.rows;
  } else {
    const bySymbol = new Map<string, Record<string, unknown>[]>();
    for (const row of marketRows) {
      const symbol = rowSymbol(row);
      if (!symbol) continue;
      bySymbol.set(symbol, [...(bySymbol.get(symbol) ?? []), row]);
    }
    rows = localResult.rows.flatMap((localRow) => {
      const symbol = rowSymbol(localRow);
      const matches = symbol ? bySymbol.get(symbol) ?? [] : [];
      return matches.length
        ? matches.map((marketRow) => ({ ...localRow, ...prefixMarketCollisions(localRow, marketRow) }))
        : [{ ...localRow, market_data_status: "MISSING" }];
    });
  }
  const boundedRows = rows.slice(0, Math.min(Math.max(1, limit), 10_000));
  const serialized = JSON.stringify(boundedRows);
  return {
    rows: boundedRows,
    columns: inferColumns(boundedRows),
    rowCount: boundedRows.length,
    isTruncated: boundedRows.length < rows.length,
    resultSizeBytes: Buffer.byteLength(serialized, "utf8"),
  };
}

function resolveSymbols(source: PandaQuerySource, rows: Record<string, unknown>[]): PandaQuerySource {
  if (Array.isArray(source.parameters.symbol) && source.parameters.symbol.length) return source;
  const symbols = [...new Set(rows.map(rowSymbol).filter((value): value is string => Boolean(value)))].slice(0, 50);
  return { ...source, parameters: { ...source.parameters, symbol: symbols } };
}

async function executeOne(source: PandaQuerySource, agentRunId: string, db: SqliteDb, call: PandaCaller): Promise<PandaSourceExecution> {
  const now = new Date().toISOString();
  const toolCallId = id("tool");
  const skillRunId = id("skillrun");
  const dataSourceId = "source-pandadata-api";
  db.prepare(`INSERT INTO tool_calls
    (id,agent_run_id,data_source_id,tool_name,tool_version,status,arguments_json,started_at,created_at)
    VALUES (?,?,?,?,?,'running',?,?,?)`).run(
    toolCallId, agentRunId, dataSourceId, source.method, "panda_data==0.0.12", JSON.stringify(source.parameters), now, now,
  );
  db.prepare(`INSERT INTO skill_runs
    (id,skill_asset_id,agent_run_id,tool_call_id,data_source_id,method_name,status,input_summary,input_json,quality_status,started_at,created_at)
    VALUES (?,'skill-pandadata-api',?,?,?,?,'running',?,?,'invalid',?,?)`)
    .run(skillRunId, agentRunId, toolCallId, dataSourceId, source.method, `${source.method} market query`, JSON.stringify(source.parameters), now, now);
  try {
    const result = await call(source.method, source.parameters);
    const completedAt = new Date().toISOString();
    const quality = result.fresh ? "valid" : "stale";
    db.prepare(`UPDATE tool_calls SET status='succeeded',result_summary=?,result_json=?,completed_at=?,latency_ms=? WHERE id=?`)
      .run(`${result.data.length} rows; ${quality}`, JSON.stringify({ rowCount: result.data.length, asOfDate: result.asOfDate, fresh: result.fresh }), completedAt, result.callDurationMs, toolCallId);
    db.prepare(`UPDATE skill_runs SET status='succeeded',output_summary=?,output_json=?,data_as_of=?,fresh_until=?,quality_status=?,completed_at=?,latency_ms=? WHERE id=?`)
      .run(`${result.data.length} rows`, JSON.stringify({ columns: distinctColumns(result.data), rowCount: result.data.length }), result.asOfDate,
        result.asOfDate ? addDays(result.asOfDate, 30) : null, quality, completedAt, result.callDurationMs, skillRunId);
    const marketSnapshotIds = persistMarketSnapshots(db, source, result, dataSourceId);
    persistProbe(db, { agentRunId, toolCallId, skillRunId, method: source.method, phase: "dry_run", status: "succeeded", durationMs: result.dryRunDurationMs });
    persistProbe(db, { agentRunId, toolCallId, skillRunId, method: source.method, phase: "live_call", status: "succeeded", durationMs: result.liveCallDurationMs, dataAsOf: result.asOfDate, freshness: result.fresh ? "fresh" : "stale" });
    return { source, result, toolCallId, skillRunId, marketSnapshotIds };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const details = errorDetails(error);
    db.prepare(`UPDATE tool_calls SET status='failed',error_code=?,error_message=?,completed_at=? WHERE id=?`)
      .run(details.code, details.message, completedAt, toolCallId);
    db.prepare(`UPDATE skill_runs SET status='failed',quality_status='invalid',error_code=?,error_message=?,completed_at=? WHERE id=?`)
      .run(details.code, details.message, completedAt, skillRunId);
    const probeDetails = pandaProbeError(error);
    if (probeDetails.phase === "live_call") {
      persistProbe(db, { agentRunId, toolCallId, skillRunId, method: source.method, phase: "dry_run", status: "succeeded", durationMs: probeDetails.dryRunDurationMs });
    }
    persistProbe(db, { agentRunId, toolCallId, skillRunId, method: source.method, phase: probeDetails.phase, status: "failed", durationMs: probeDetails.durationMs, errorCategory: details.code, errorMessage: details.message });
    throw error;
  }
}

function persistMarketSnapshots(db: SqliteDb, source: PandaQuerySource, result: PandaDataResult, dataSourceId: string): string[] {
  const createdAt = new Date().toISOString();
  const snapshotIds: string[] = [];
  const transaction = db.transaction(() => {
    for (const row of result.data.slice(0, 10_000)) {
      const symbol = rowSymbol(row);
      if (!symbol) continue;
      const instrumentId = ensureInstrument(db, symbol, source.assetType);
      const asOf = normalizeDate(row.date ?? row.trade_date ?? result.asOfDate) ?? createdAt;
      const snapshotId = `market_${digest(`${instrumentId}|${source.method}|${asOf}`)}`;
      snapshotIds.push(snapshotId);
      db.prepare(`INSERT OR IGNORE INTO market_snapshots
        (id,instrument_id,data_source_id,snapshot_type,as_of,trading_date,market_timezone,freshness_status,quality_status,source_method,source_parameters_json,raw_payload_json,created_at)
        VALUES (?,?,?,'quote',?,?,?,?,?,?,?,?,?)`).run(
        snapshotId, instrumentId, dataSourceId, asOf, asOf.slice(0, 10), marketTimezone(symbol), result.fresh ? "fresh" : "stale",
        result.data.length ? "valid" : "partial", source.method, JSON.stringify(source.parameters), JSON.stringify(row), createdAt,
      );
      for (const [metricCode, value] of Object.entries(row)) {
        if (["symbol", "date", "trade_date", "name"].includes(metricCode) || value === null || value === undefined) continue;
        const decimalValue = decimalString(value);
        const textValue = decimalValue === null ? String(value).slice(0, 200) : null;
        db.prepare(`INSERT OR IGNORE INTO market_snapshot_metrics
          (id,market_snapshot_id,metric_code,metric_name,value_decimal,value_text,period_code,quality_status,created_at)
          VALUES (?,?,?,?,?,?,'spot','valid',?)`).run(
          `metric_${digest(`${snapshotId}|${metricCode}`)}`, snapshotId, metricCode, metricCode, decimalValue, textValue, createdAt,
        );
      }
    }
  });
  transaction();
  return [...new Set(snapshotIds)];
}

function ensureInstrument(db: SqliteDb, symbol: string, assetType: string): string {
  const existing = db.prepare("SELECT id FROM instruments WHERE UPPER(symbol)=? LIMIT 1").get(symbol) as { id?: string } | undefined;
  if (existing?.id) return existing.id;
  const instrumentId = `instrument_${digest(symbol)}`;
  db.prepare("INSERT OR IGNORE INTO instruments (id,symbol,name,market,asset_type,tradable) VALUES (?,?,?,?,?,1)")
    .run(instrumentId, symbol, symbol, marketCode(symbol), assetType);
  return instrumentId;
}

function inferColumns(rows: Record<string, unknown>[]): Array<{ name: string; type: string }> {
  return distinctColumns(rows).map((name) => {
    const sample = rows.find((row) => row[name] !== null && row[name] !== undefined)?.[name];
    return { name, type: typeof sample === "number" ? "NUMERIC" : "TEXT" };
  });
}

function distinctColumns(rows: Record<string, unknown>[]): string[] {
  return [...new Set(rows.flatMap((row) => Object.keys(row)))];
}

function prefixMarketCollisions(local: Record<string, unknown>, market: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(market).map(([key, value]) => [key in local && key !== "symbol" ? `market_${key}` : key, value]));
}

function rowSymbol(row: Record<string, unknown>): string | null {
  const value = row.symbol ?? row.ts_code ?? row.code;
  return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : null;
}

function decimalString(value: unknown): string | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  try {
    const decimal = new Decimal(String(value));
    return decimal.isFinite() ? decimal.toString() : null;
  } catch {
    return null;
  }
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const digits = String(value).replace(/\D/gu, "");
  return digits.length >= 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T00:00:00.000Z` : null;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date.slice(0, 10)}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString();
}

function marketCode(symbol: string): string {
  return symbol.includes(".") ? symbol.split(".").at(-1) ?? "UNKNOWN" : "US";
}

function marketTimezone(symbol: string): string {
  return /\.(?:SH|SZ|OF)$/u.test(symbol) ? "Asia/Shanghai" : /\.HK$/u.test(symbol) ? "Asia/Hong_Kong" : "America/New_York";
}

function errorDetails(error: unknown): { code: string; message: string } {
  if (error && typeof error === "object") {
    const candidate = error as { code?: string; message?: string; details?: { category?: string } };
    return { code: candidate.details?.category ?? candidate.code ?? "PANDADATA_UNAVAILABLE", message: (candidate.message ?? "PandaData unavailable").slice(0, 500) };
  }
  return { code: "PANDADATA_UNAVAILABLE", message: String(error).slice(0, 500) };
}

function pandaProbeError(error: unknown): { phase: "dry_run" | "live_call"; durationMs: number; dryRunDurationMs: number } {
  const details = error && typeof error === "object" && "details" in error
    ? (error as { details?: Record<string, unknown> }).details ?? {}
    : {};
  return {
    phase: details.phase === "LIVE_CALL" ? "live_call" : "dry_run",
    durationMs: Number(details.durationMs ?? 0),
    dryRunDurationMs: Number(details.dryRunDurationMs ?? 0),
  };
}

function persistProbe(db: SqliteDb, input: {
  agentRunId: string;
  toolCallId: string;
  skillRunId: string;
  method: string;
  phase: "dry_run" | "live_call";
  status: "succeeded" | "failed";
  durationMs: number;
  dataAsOf?: string | null;
  freshness?: "fresh" | "stale";
  errorCategory?: string;
  errorMessage?: string;
}): void {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO pandadata_probes
    (id,agent_run_id,tool_call_id,skill_run_id,method_name,phase,status,duration_ms,data_as_of,freshness_status,error_category,error_message,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id("probe"), input.agentRunId, input.toolCallId, input.skillRunId, input.method, input.phase, input.status,
    normalizeDuration(input.durationMs), input.dataAsOf ?? null, input.freshness ?? null,
    input.errorCategory ?? null, input.errorMessage?.slice(0, 500) ?? null, now,
  );
}

function normalizeDuration(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}
