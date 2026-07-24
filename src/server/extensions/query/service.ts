import { createHash } from "node:crypto";

import { getDatabase, createId, isoNow, json, parseJson } from "@/server/http/context";

import { executeQuery } from "./executor";
import { generateQueryPlan } from "./plan-generator";
import { combineQueryResults, executePandaSources } from "./panda-query-executor";
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
  MARKET_STOCK_DAILY: "pandadata:get_stock_daily",
  MARKET_FUND_DAILY: "pandadata:get_fund_daily",
  MARKET_INDEX_DAILY: "pandadata:get_index_daily",
  MARKET_US_DAILY: "pandadata:get_us_daily",
  MARKET_HK_DAILY: "pandadata:get_hk_daily",
};
const ALLOWED_DATASETS = new Set(Object.keys(DATASET_TABLES));

export async function createAndRunDataQuery(input: CreateDataQueryInput) {
  const db = getDatabase();
  const invalidDataset = input.requestedDatasets.find((dataset) => !ALLOWED_DATASETS.has(dataset.toUpperCase()));
  if (invalidDataset) {
    db.close();
    throw new Error(`Dataset is not allowed: ${invalidDataset}`);
  }
  if (input.sessionId) {
    const session = db.prepare("SELECT id FROM conversation_sessions WHERE id=? AND user_id=?").get(input.sessionId, input.userId);
    if (!session) { db.close(); throw new Error("Conversation not found"); }
  }
  if (input.sourceMessageId) {
    const message = db.prepare(`SELECT m.id,m.session_id FROM messages m JOIN conversation_sessions c ON c.id=m.session_id
      WHERE m.id=? AND c.user_id=?`).get(input.sourceMessageId, input.userId) as { id?: string; session_id?: string } | undefined;
    if (!message) { db.close(); throw new Error("Source message not found"); }
    if (input.sessionId && message.session_id !== input.sessionId) { db.close(); throw new Error("Source message does not belong to conversation"); }
  }
  const queryId = createId("query");
  const analysisId = createId("analysis");
  const now = isoNow();
  const { plan, sql, parameters, planner, pandaSources } = await generateQueryPlan(
    input.questionText,
    input.requestedDatasets,
    input.accountScope ?? null,
    input.userId,
    input.requestedLimit,
    db,
  );

  db.prepare("INSERT INTO agent_runs (id, user_id, type, status, created_at) VALUES (?, ?, ?, ?, ?)").run(analysisId, input.userId, "data_query", "running", now);
  db.prepare(`INSERT INTO data_queries
    (id, user_id, session_id, source_message_id, agent_run_id, question_text, account_scope_json,
     requested_datasets_json, output_mode, requested_limit, status, plan_json, redacted_sql,
     parameter_types_json, safety_checks_json, created_at, updated_at, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?)`)
    .run(queryId, input.userId, input.sessionId ?? null, input.sourceMessageId ?? null, analysisId,
      input.questionText, json(input.accountScope ?? []), json(input.requestedDatasets), input.outputMode,
      input.requestedLimit, json(plan), sql ?? pandaSources.map((source) => `PANDADATA:${source.method}`).join(","), json([...parameters.map((value) => typeof value), ...(pandaSources.length ? ["PANDADATA_CONTRACT"] : [])]),
      json(["SEMANTIC_QUERY_PLAN", ...(sql ? ["PARAMETERIZED_SQL", "SINGLE_SELECT", "WHITELISTED_DATASET", "SQLITE_AUTHORIZER"] : []), ...(pandaSources.length ? ["PANDADATA_CONTRACT", "PANDADATA_DRY_RUN", "EXPLICIT_SOURCE"] : [])]), now, now, now);

  try {
    const localResult = sql ? await executeQuery(sql, input.requestedLimit, () => db, parameters) : null;
    const pandaExecutions = await executePandaSources({ sources: pandaSources, agentRunId: analysisId, localRows: localResult?.rows ?? [], db });
    const result = combineQueryResults(localResult, pandaExecutions, input.requestedLimit);
    const sourceSummary = [
      ...(sql ? [{ type: "LOCAL_DATABASE", label: "Portfolio database", planner }] : []),
      ...pandaExecutions.map(({ source, result: pandaResult, toolCallId, skillRunId }) => ({
        type: "PANDADATA", label: source.dataset, method: source.method, asOfDate: pandaResult.asOfDate,
        fresh: pandaResult.fresh, errorCategory: pandaResult.errorCategory, toolCallId, skillRunId,
      })),
    ];
    const dataAsOf = pandaExecutions.map((item) => item.result.asOfDate).filter((value): value is string => Boolean(value)).sort().at(-1) ?? now;
    persistQueryResult({ queryId, result, getDb: () => db });
    db.prepare("UPDATE data_queries SET column_metadata_json = ?, data_as_of = ?, source_summary_json = ?, updated_at = ? WHERE id = ?")
      .run(json(result.columns), dataAsOf, json(sourceSummary), isoNow(), queryId);
    db.prepare("UPDATE agent_runs SET status = 'completed', completed_at = ? WHERE id = ?").run(isoNow(), analysisId);
    await persistSseEvent({ analysisId, type: "query.planned", payload: { queryId, datasets: plan.datasets, columns: result.columns, planner } });
    await persistSseEvent({ analysisId, type: "query.validated", payload: { queryId, safetyChecks: ["SEMANTIC_QUERY_PLAN", "PARAMETERIZED_SQL", "SINGLE_SELECT", "WHITELISTED_DATASET", "SQLITE_AUTHORIZER"] } });
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
  if (!row) { db.close(); return null; }
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
  if (query.result_expires_at && Date.parse(String(query.result_expires_at)) <= Date.now()) return { expired: true };
  const rows = query.rows.slice(offset, offset + limit).map((values, index) => ({ rowId: `row_${offset + index + 1}`, values }));
  return { columns: query.columns, items: rows, rowCount: query.row_count ?? query.rows.length, truncated: Boolean(query.is_truncated), dataAsOf: query.data_as_of };
}

export function resultDigest(rows: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
