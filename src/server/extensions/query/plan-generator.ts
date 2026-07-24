import { ALLOWED_TABLES, validateSql } from "../security/sql-ast-parser";
import type { QueryPlan } from "./types";

type DatasetKey =
  | "PORTFOLIO_SNAPSHOTS"
  | "PORTFOLIO_HOLDINGS"
  | "HOLDING_SNAPSHOTS"
  | "PORTFOLIO_METRICS"
  | "INSTRUMENTS";

export interface GeneratedQueryPlan {
  plan: QueryPlan;
  sql: string;
  parameters: unknown[];
  planner: "SEMANTIC_RULES";
}

const DATASET_ALIASES: Record<string, DatasetKey> = {
  PORTFOLIO_SNAPSHOTS: "PORTFOLIO_SNAPSHOTS",
  PORTFOLIO_HOLDINGS: "PORTFOLIO_HOLDINGS",
  HOLDING_SNAPSHOTS: "HOLDING_SNAPSHOTS",
  PORTFOLIO_METRICS: "PORTFOLIO_METRICS",
  INSTRUMENTS: "INSTRUMENTS",
  portfolio_snapshots: "PORTFOLIO_SNAPSHOTS",
  holding_snapshots: "HOLDING_SNAPSHOTS",
  portfolio_score_snapshots: "PORTFOLIO_METRICS",
  instruments: "INSTRUMENTS",
};

const DATASET_TABLES: Record<DatasetKey, string[]> = {
  PORTFOLIO_SNAPSHOTS: ["portfolio_snapshots"],
  PORTFOLIO_HOLDINGS: ["holding_snapshots", "portfolio_snapshots", "instruments"],
  HOLDING_SNAPSHOTS: ["holding_snapshots", "portfolio_snapshots", "instruments"],
  PORTFOLIO_METRICS: ["portfolio_score_snapshots", "portfolio_snapshots"],
  INSTRUMENTS: ["instruments"],
};

export async function generateQueryPlan(
  question: string,
  requestedDatasets: string[],
  accountScope: string[] | null,
  userId: string,
  requestedLimit = 2_000,
): Promise<GeneratedQueryPlan> {
  const datasets = normalizeDatasets(requestedDatasets);
  if (datasets.length === 0) throw new Error("No valid datasets were requested");

  const primary = choosePrimaryDataset(question, datasets);
  const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 10_000);
  const generated = primary === "PORTFOLIO_HOLDINGS" || primary === "HOLDING_SNAPSHOTS"
    ? buildHoldingQuery(question, primary, userId, accountScope, limit)
    : primary === "PORTFOLIO_METRICS"
      ? buildMetricQuery(userId, accountScope, limit)
      : primary === "INSTRUMENTS"
        ? buildInstrumentQuery(question, limit)
        : buildSnapshotQuery(question, userId, accountScope, limit);

  const allowedTables = new Set(datasets.flatMap((dataset) => DATASET_TABLES[dataset]));
  const validation = validateSql(generated.sql, allowedTables);
  if (!validation.valid) throw new Error(`Generated query failed SQL security validation: ${validation.reason ?? "unknown"}`);
  return { ...generated, planner: "SEMANTIC_RULES" };
}

function normalizeDatasets(values: string[]): DatasetKey[] {
  return [...new Set(values.flatMap((value) => {
    const normalized = DATASET_ALIASES[value] ?? DATASET_ALIASES[value.toUpperCase()];
    return normalized ? [normalized] : [];
  }))];
}

function choosePrimaryDataset(question: string, datasets: DatasetKey[]): DatasetKey {
  const text = question.toLowerCase();
  const preferred = /风险|健康|评分|risk|health|score/u.test(text)
    ? "PORTFOLIO_METRICS"
    : /标的|证券|代码|instrument|symbol/u.test(text) && !/持仓|组合|holding|portfolio/u.test(text)
      ? "INSTRUMENTS"
      : /持仓|仓位|行业|板块|浮盈|浮亏|市值|holding|position|sector|pnl/u.test(text)
        ? "PORTFOLIO_HOLDINGS"
        : /快照|资产变化|历史组合|snapshot/u.test(text)
          ? "PORTFOLIO_SNAPSHOTS"
          : null;
  return preferred && datasets.includes(preferred) ? preferred : datasets[0];
}

function buildHoldingQuery(
  question: string,
  dataset: "PORTFOLIO_HOLDINGS" | "HOLDING_SNAPSHOTS",
  userId: string,
  accountScope: string[] | null,
  limit: number,
): Omit<GeneratedQueryPlan, "planner"> {
  const text = question.toLowerCase();
  const parameters: unknown[] = [userId];
  const conditions = ["ps.user_id = ?"];
  appendPortfolioScope(conditions, parameters, accountScope, "ps.portfolio_id");
  const symbol = extractSymbol(question);
  if (symbol) {
    conditions.push("UPPER(i.symbol) = ?");
    parameters.push(symbol);
  }

  let dimensions: string[];
  let metrics: string[];
  let select: string;
  let groupBy = "";
  if (/行业|板块|sector/u.test(text)) {
    dimensions = ["sector"];
    metrics = ["SUM(market_value)", "SUM(unrealized_pnl)", "COUNT(*)"];
    select = `COALESCE(i.sector, '未分类') AS sector,
      ROUND(SUM(CAST(h.market_value_decimal AS REAL)), 2) AS market_value,
      ROUND(SUM(CAST(h.unrealized_pnl_decimal AS REAL)), 2) AS unrealized_pnl,
      COUNT(*) AS holding_count`;
    groupBy = "GROUP BY COALESCE(i.sector, '未分类')";
  } else if (/类型|品类|asset type|asset_type/u.test(text)) {
    dimensions = ["asset_type"];
    metrics = ["SUM(market_value)", "SUM(unrealized_pnl)", "COUNT(*)"];
    select = `UPPER(COALESCE(i.asset_type, 'UNKNOWN')) AS asset_type,
      ROUND(SUM(CAST(h.market_value_decimal AS REAL)), 2) AS market_value,
      ROUND(SUM(CAST(h.unrealized_pnl_decimal AS REAL)), 2) AS unrealized_pnl,
      COUNT(*) AS holding_count`;
    groupBy = "GROUP BY UPPER(COALESCE(i.asset_type, 'UNKNOWN'))";
  } else if (/合计|总计|一共|总市值|总浮盈|sum|total|count/u.test(text)) {
    dimensions = [];
    metrics = ["SUM(market_value)", "SUM(unrealized_pnl)", "COUNT(*)"];
    select = `ROUND(SUM(CAST(h.market_value_decimal AS REAL)), 2) AS market_value,
      ROUND(SUM(CAST(h.unrealized_pnl_decimal AS REAL)), 2) AS unrealized_pnl,
      COUNT(*) AS holding_count`;
  } else {
    dimensions = ["symbol", "name", "asset_type", "sector", "quantity", "average_cost", "market_price", "market_value", "unrealized_pnl", "weight"];
    metrics = [];
    select = `i.symbol, i.name, UPPER(i.asset_type) AS asset_type, i.sector,
      CAST(h.quantity_decimal AS REAL) AS quantity,
      CAST(h.cost_decimal AS REAL) AS average_cost,
      CAST(h.price_decimal AS REAL) AS market_price,
      CAST(h.market_value_decimal AS REAL) AS market_value,
      CAST(h.unrealized_pnl_decimal AS REAL) AS unrealized_pnl,
      ROUND(h.weight_bps / 100.0, 2) AS weight_pct`;
  }

  const sql = `SELECT ${select}
    FROM holding_snapshots h
    JOIN portfolio_snapshots ps ON ps.id = h.portfolio_snapshot_id
    LEFT JOIN instruments i ON i.id = h.instrument_id
    WHERE ${conditions.join(" AND ")}
    ${groupBy}
    ORDER BY market_value DESC
    LIMIT ${limit}`;
  return {
    plan: { datasets: [dataset], dimensions, metrics, filters: symbol ? [{ column: "symbol", operator: "eq", value: symbol }] : [], orderBy: "market_value DESC", limit },
    sql,
    parameters,
  };
}

function buildMetricQuery(
  userId: string,
  accountScope: string[] | null,
  limit: number,
): Omit<GeneratedQueryPlan, "planner"> {
  const parameters: unknown[] = [userId];
  const conditions = ["ps.user_id = ?"];
  appendPortfolioScope(conditions, parameters, accountScope, "ps.portfolio_id");
  return {
    plan: {
      datasets: ["PORTFOLIO_METRICS"],
      dimensions: ["portfolio_id", "health_score", "risk_score", "score_version", "computed_at"],
      metrics: [], filters: [], orderBy: "computed_at DESC", limit,
    },
    sql: `SELECT ps.portfolio_id, s.health_score, s.risk_score, s.score_version, s.computed_at
      FROM portfolio_score_snapshots s
      JOIN portfolio_snapshots ps ON ps.id = s.portfolio_snapshot_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY s.computed_at DESC
      LIMIT ${limit}`,
    parameters,
  };
}

function buildSnapshotQuery(
  question: string,
  userId: string,
  accountScope: string[] | null,
  limit: number,
): Omit<GeneratedQueryPlan, "planner"> {
  const parameters: unknown[] = [userId];
  const conditions = ["user_id = ?"];
  appendPortfolioScope(conditions, parameters, accountScope, "portfolio_id");
  const totalOnly = /合计|总计|总资产|sum|total/u.test(question.toLowerCase());
  const select = totalOnly
    ? "ROUND(SUM(CAST(cash_decimal AS REAL) + CAST(total_market_value_decimal AS REAL)), 2) AS total_assets, COUNT(*) AS snapshot_count"
    : "id, portfolio_id, CAST(cash_decimal AS REAL) AS cash, CAST(total_market_value_decimal AS REAL) AS market_value, data_quality, as_of";
  return {
    plan: {
      datasets: ["PORTFOLIO_SNAPSHOTS"],
      dimensions: totalOnly ? [] : ["id", "portfolio_id", "cash", "market_value", "data_quality", "as_of"],
      metrics: totalOnly ? ["SUM(total_assets)", "COUNT(*)"] : [], filters: [], orderBy: totalOnly ? undefined : "as_of DESC", limit,
    },
    sql: `SELECT ${select} FROM portfolio_snapshots WHERE ${conditions.join(" AND ")} ${totalOnly ? "" : "ORDER BY as_of DESC"} LIMIT ${limit}`,
    parameters,
  };
}

function buildInstrumentQuery(question: string, limit: number): Omit<GeneratedQueryPlan, "planner"> {
  const parameters: unknown[] = [];
  const conditions = ["tradable = 1"];
  const symbol = extractSymbol(question);
  if (symbol) { conditions.push("UPPER(symbol) = ?"); parameters.push(symbol); }
  return {
    plan: {
      datasets: ["INSTRUMENTS"], dimensions: ["symbol", "name", "market", "asset_type", "sector"], metrics: [],
      filters: symbol ? [{ column: "symbol", operator: "eq", value: symbol }] : [], orderBy: "symbol ASC", limit,
    },
    sql: `SELECT symbol, name, market, UPPER(asset_type) AS asset_type, sector FROM instruments WHERE ${conditions.join(" AND ")} ORDER BY symbol LIMIT ${limit}`,
    parameters,
  };
}

function appendPortfolioScope(conditions: string[], parameters: unknown[], accountScope: string[] | null, column: string): void {
  if (!accountScope?.length) return;
  conditions.push(`${column} IN (${accountScope.map(() => "?").join(", ")})`);
  parameters.push(...accountScope);
}

function extractSymbol(question: string): string | null {
  const matches = question.toUpperCase().match(/\b[A-Z]{1,6}(?:\.(?:SH|SZ|HK|OF))?\b/gu) ?? [];
  const ignored = new Set(["SQL", "ETF", "AI", "A", "B", "C", "SUM", "COUNT", "TOTAL"]);
  return matches.find((value) => !ignored.has(value)) ?? null;
}

export function assertQueryCatalog(): void {
  for (const tables of Object.values(DATASET_TABLES)) {
    for (const table of tables) if (!ALLOWED_TABLES.has(table)) throw new Error(`Dataset table is not allowlisted: ${table}`);
  }
}
