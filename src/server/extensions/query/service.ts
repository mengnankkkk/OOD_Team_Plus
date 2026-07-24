import { createHash } from "node:crypto";

import { getDatabase, createId, isoNow, json, parseJson } from "@/server/http/context";

import { executeQuery } from "./executor";
import { persistQueryResult } from "./result-persister";
import type { QueryPlan } from "./types";
import { persistSseEvent } from "../sse/event-persister";

export type CreateDataQueryInput = {
  userId: string;
  questionText: string;
  requestedDatasets: string[];
  outputMode: "SQL_ONLY" | "CHART" | "FINANCIAL_REPORT";
  requestedLimit: number;
  accountScope?: string[];
  sessionId?: string;
  sourceMessageId?: string;
};

const DATASET_TABLES: Record<string, string> = {
  PORTFOLIO_SNAPSHOTS: "portfolio_snapshots",
  PORTFOLIO_HOLDINGS: "holding_snapshots",
  PORTFOLIO_METRICS: "portfolio_score_snapshots",
  HOLDING_SNAPSHOTS: "holding_snapshots",
  INSTRUMENTS: "instruments",
};

export async function createAndRunDataQuery(input: CreateDataQueryInput) {
  const db = getDatabase();
  const queryId = createId("query");
  const analysisId = createId("analysis");
  const now = isoNow();
  const table = chooseTable(input.requestedDatasets);
  const { plan, sql } = buildLocalPlan(input.questionText, table, input.requestedLimit, input.userId);

  db.prepare("INSERT INTO agent_runs (id, user_id, type, status, created_at) VALUES (?, ?, ?, ?, ?)").run(analysisId, input.userId, "data_query", "running", now);
  db.prepare(`INSERT INTO data_queries
    (id, user_id, session_id, source_message_id, agent_run_id, question_text, account_scope_json,
     requested_datasets_json, output_mode, requested_limit, status, plan_json, redacted_sql,
     parameter_types_json, safety_checks_json, created_at, updated_at, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?)`)
    .run(queryId, input.userId, input.sessionId ?? null, input.sourceMessageId ?? null, analysisId,
      input.questionText, json(input.accountScope ?? []), json(input.requestedDatasets), input.outputMode,
      input.requestedLimit, json(plan), sql, json(["TEXT", "INTEGER"]),
      json(["SINGLE_SELECT", "WHITELISTED_DATASET", "SQLITE_AUTHORIZER"]), now, now, now);

  try {
    const result = await executeQuery(sql, input.requestedLimit, () => db);
    persistQueryResult({ queryId, result, getDb: () => db });
    db.prepare("UPDATE data_queries SET column_metadata_json = ?, data_as_of = ?, source_summary_json = ?, updated_at = ? WHERE id = ?")
      .run(json(result.columns), now, json([{ type: "LOCAL_DATABASE", label: "Portfolio database" }]), isoNow(), queryId);
    db.prepare("UPDATE agent_runs SET status = 'completed', completed_at = ? WHERE id = ?").run(isoNow(), analysisId);
    await persistSseEvent({ analysisId, type: "query.planned", payload: { queryId, datasets: input.requestedDatasets, columns: result.columns } });
    await persistSseEvent({ analysisId, type: "query.validated", payload: { queryId, safetyChecks: ["SINGLE_SELECT", "WHITELISTED_DATASET", "SQLITE_AUTHORIZER"] } });
    await persistSseEvent({ analysisId, type: "query.completed", payload: { queryId, rowCount: result.rowCount, truncated: result.isTruncated } });
    return { queryId, analysisId, status: "COMPLETED", plan, sql, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Query execution failed";
    db.prepare("UPDATE data_queries SET status = 'failed', failure_code = ?, failure_message = ?, completed_at = ? WHERE id = ?")
      .run("QUERY_FAILED", message.slice(0, 500), isoNow(), queryId);
    db.prepare("UPDATE agent_runs SET status = 'failed', completed_at = ? WHERE id = ?").run(isoNow(), analysisId);
    throw error;
  } finally {
    (db as unknown as { close?: () => void }).close?.();
  }
}

export function getDataQuery(userId: string, queryId: string) {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM data_queries WHERE id = ? AND user_id = ?").get(queryId, userId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const result = db.prepare("SELECT rows_json FROM data_query_result_chunks WHERE query_id = ? ORDER BY chunk_no").all(queryId) as Array<{ rows_json: string }>;
  (db as unknown as { close?: () => void }).close?.();
  return { ...row, plan: parseJson(row.plan_json as string | null, null), columns: parseJson(row.column_metadata_json as string | null, []), rows: result.flatMap((chunk) => parseJson<Record<string, unknown>[]>(chunk.rows_json, [])) } as Record<string, unknown> & { rows: Record<string, unknown>[]; plan: QueryPlan | null; columns: Array<Record<string, unknown>> };
}

export function listDataQueries(userId: string, limit: number, status?: string) {
  const db = getDatabase();
  const rows = status
    ? db.prepare("SELECT * FROM data_queries WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?").all(userId, status.toLowerCase(), limit)
    : db.prepare("SELECT * FROM data_queries WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(userId, limit);
  (db as unknown as { close?: () => void }).close?.();
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: row.id, question: row.question_text, status: String(row.status).toUpperCase(), outputMode: String(row.output_mode).toUpperCase(),
    rowCount: row.row_count ?? 0, truncated: Boolean(row.is_truncated), dataAsOf: row.data_as_of, createdAt: row.created_at,
    analysisId: row.agent_run_id,
  }));
}

export function getQueryResult(userId: string, queryId: string, limit: number, offset: number) {
  const query = getDataQuery(userId, queryId);
  if (!query) return null;
  if (query.status !== "succeeded") return { notReady: true, status: query.status };
  const rows = query.rows.slice(offset, offset + limit).map((values, index) => ({ rowId: `row_${offset + index + 1}`, values }));
  return { columns: query.columns, items: rows, rowCount: query.row_count ?? query.rows.length, truncated: Boolean(query.is_truncated), dataAsOf: query.data_as_of };
}

function chooseTable(datasets: string[]): string {
  const normalized = datasets.map((dataset) => DATASET_TABLES[dataset.toUpperCase()] ?? dataset.toLowerCase());
  const selected = normalized.find((table) => ["holding_snapshots", "portfolio_snapshots", "portfolio_score_snapshots", "instruments"].includes(table));
  if (!selected) throw new Error("Dataset is not allowed");
  return selected;
}

function buildLocalPlan(question: string, table: string, limit: number, userId: string): { plan: QueryPlan; sql: string } {
  const plan: QueryPlan = { datasets: [table], dimensions: [], metrics: [], filters: [], limit: Math.min(Math.max(limit, 1), 10_000) };
  if (table === "holding_snapshots") {
    plan.dimensions = ["instrument_id", "quantity_decimal", "cost_decimal", "price_decimal", "market_value_decimal", "unrealized_pnl_decimal", "weight_bps"];
    plan.filters = [{ column: "portfolio_snapshot_id", operator: "like", value: "%" }];
    return { plan, sql: `SELECT instrument_id, quantity_decimal, cost_decimal, price_decimal, market_value_decimal, unrealized_pnl_decimal, weight_bps FROM holding_snapshots WHERE portfolio_snapshot_id IN (SELECT id FROM portfolio_snapshots WHERE user_id = '${escape(userId)}') LIMIT ${plan.limit}` };
  }
  if (table === "portfolio_score_snapshots") {
    plan.dimensions = ["portfolio_snapshot_id", "health_score", "risk_score", "score_version", "computed_at"];
    return { plan, sql: `SELECT portfolio_snapshot_id, health_score, risk_score, score_version, computed_at FROM portfolio_score_snapshots WHERE portfolio_snapshot_id IN (SELECT id FROM portfolio_snapshots WHERE user_id = '${escape(userId)}') LIMIT ${plan.limit}` };
  }
  if (table === "instruments") {
    plan.dimensions = ["id", "symbol", "name", "market", "asset_type", "sector"];
    return { plan, sql: `SELECT id, symbol, name, market, asset_type, sector FROM instruments LIMIT ${plan.limit}` };
  }
  plan.dimensions = ["id", "portfolio_id", "cash_decimal", "total_market_value_decimal", "as_of"];
  return { plan, sql: `SELECT id, portfolio_id, cash_decimal, total_market_value_decimal, as_of FROM portfolio_snapshots WHERE user_id = '${escape(userId)}' LIMIT ${plan.limit}` };
}

function escape(value: string): string {
  return value.replaceAll("'", "''");
}

export function resultDigest(rows: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
