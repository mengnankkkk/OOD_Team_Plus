import type { QueryPlan } from "./types";

export type SemanticDatasetKey = "PORTFOLIO_SNAPSHOTS" | "PORTFOLIO_HOLDINGS" | "HOLDING_SNAPSHOTS" | "PORTFOLIO_METRICS" | "INSTRUMENTS";

export type DatasetDefinition = {
  from: string;
  tables: string[];
  ownerColumn?: string;
  scopeColumn?: string;
  timeColumn?: string;
  defaultDimensions: string[];
  columns: Record<string, string>;
  metrics: Record<string, { expression: string; alias: string }>;
};

export const SEMANTIC_DATASETS: Record<SemanticDatasetKey, DatasetDefinition> = {
  PORTFOLIO_SNAPSHOTS: {
    from: "portfolio_snapshots ps", tables: ["portfolio_snapshots"], ownerColumn: "ps.user_id", scopeColumn: "ps.portfolio_id", timeColumn: "ps.as_of",
    defaultDimensions: ["id", "portfolio_id", "cash", "market_value", "data_quality", "as_of"],
    columns: { id: "ps.id", portfolio_id: "ps.portfolio_id", account_id: "ps.portfolio_id", cash: "CAST(ps.cash_decimal AS REAL)", market_value: "CAST(ps.total_market_value_decimal AS REAL)", total_assets: "CAST(ps.cash_decimal AS REAL) + CAST(ps.total_market_value_decimal AS REAL)", data_quality: "ps.data_quality", as_of: "ps.as_of" },
    metrics: { "COUNT(*)": { expression: "COUNT(*)", alias: "snapshot_count" }, "SUM(total_assets)": { expression: "SUM(CAST(ps.cash_decimal AS REAL) + CAST(ps.total_market_value_decimal AS REAL))", alias: "total_assets" } },
  },
  PORTFOLIO_HOLDINGS: holdingDataset(),
  HOLDING_SNAPSHOTS: holdingDataset(),
  PORTFOLIO_METRICS: {
    from: "portfolio_score_snapshots score JOIN portfolio_snapshots ps ON ps.id = score.portfolio_snapshot_id", tables: ["portfolio_score_snapshots", "portfolio_snapshots"], ownerColumn: "ps.user_id", scopeColumn: "ps.portfolio_id", timeColumn: "score.computed_at",
    defaultDimensions: ["portfolio_id", "health_score", "risk_score", "score_version", "computed_at"],
    columns: { portfolio_id: "ps.portfolio_id", account_id: "ps.portfolio_id", health_score: "score.health_score", risk_score: "score.risk_score", score_version: "score.score_version", computed_at: "score.computed_at" },
    metrics: { "COUNT(*)": { expression: "COUNT(*)", alias: "score_count" }, "AVG(health_score)": { expression: "AVG(score.health_score)", alias: "average_health_score" }, "AVG(risk_score)": { expression: "AVG(score.risk_score)", alias: "average_risk_score" } },
  },
  INSTRUMENTS: {
    from: "instruments i", tables: ["instruments"], defaultDimensions: ["symbol", "name", "market", "asset_type", "sector"],
    columns: { symbol: "i.symbol", name: "i.name", market: "i.market", asset_type: "UPPER(i.asset_type)", sector: "i.sector", tradable: "i.tradable" },
    metrics: { "COUNT(*)": { expression: "COUNT(*)", alias: "instrument_count" } },
  },
};

function holdingDataset(): DatasetDefinition {
  return {
    from: "holding_snapshots h JOIN portfolio_snapshots ps ON ps.id = h.portfolio_snapshot_id LEFT JOIN instruments i ON i.id = h.instrument_id",
    tables: ["holding_snapshots", "portfolio_snapshots", "instruments"], ownerColumn: "ps.user_id", scopeColumn: "ps.portfolio_id", timeColumn: "ps.as_of",
    defaultDimensions: ["symbol", "name", "asset_type", "sector", "quantity", "average_cost", "market_price", "market_value", "unrealized_pnl", "weight_pct"],
    columns: { portfolio_id: "ps.portfolio_id", account_id: "ps.portfolio_id", symbol: "i.symbol", name: "i.name", asset_type: "UPPER(i.asset_type)", sector: "COALESCE(i.sector, '未分类')", quantity: "CAST(h.quantity_decimal AS REAL)", average_cost: "CAST(h.cost_decimal AS REAL)", market_price: "CAST(h.price_decimal AS REAL)", market_value: "CAST(h.market_value_decimal AS REAL)", unrealized_pnl: "CAST(h.unrealized_pnl_decimal AS REAL)", weight: "h.weight_bps / 10000.0", weight_pct: "h.weight_bps / 100.0", as_of: "ps.as_of" },
    metrics: { "COUNT(*)": { expression: "COUNT(*)", alias: "holding_count" }, "SUM(market_value)": { expression: "SUM(CAST(h.market_value_decimal AS REAL))", alias: "market_value" }, "SUM(unrealized_pnl)": { expression: "SUM(CAST(h.unrealized_pnl_decimal AS REAL))", alias: "unrealized_pnl" }, "AVG(weight)": { expression: "AVG(h.weight_bps / 10000.0)", alias: "average_weight" } },
  };
}

export function compileSemanticPlan(plan: QueryPlan, userId: string, accountScope: string[] | null, hardLimit: number) {
  const datasetKey = plan.datasets[0] as SemanticDatasetKey;
  const dataset = SEMANTIC_DATASETS[datasetKey];
  if (!dataset) throw new Error(`Semantic dataset is not available: ${datasetKey}`);
  if (plan.datasets.length !== 1) throw new Error("Local QueryPlan currently requires exactly one primary dataset");
  const dimensions = plan.dimensions.length ? plan.dimensions : plan.metrics.length ? [] : dataset.defaultDimensions;
  const selections: string[] = [];
  const groupBy: string[] = [];
  for (const dimension of dimensions) {
    const expression = dataset.columns[dimension];
    if (!expression) throw new Error(`QueryPlan references an unknown semantic column: ${dimension}`);
    selections.push(`${expression} AS "${dimension}"`);
    groupBy.push(expression);
  }
  for (const metricName of plan.metrics) {
    const metric = dataset.metrics[canonicalMetric(metricName)];
    if (!metric) throw new Error(`QueryPlan references an unknown semantic metric: ${metricName}`);
    selections.push(`${metric.expression} AS "${metric.alias}"`);
  }
  if (!selections.length) throw new Error("QueryPlan did not select any fields");

  const parameters: unknown[] = [];
  const conditions: string[] = [];
  if (dataset.ownerColumn) { conditions.push(`${dataset.ownerColumn} = ?`); parameters.push(userId); }
  if (dataset.scopeColumn && accountScope?.length) {
    conditions.push(`${dataset.scopeColumn} IN (${accountScope.map(() => "?").join(", ")})`);
    parameters.push(...accountScope);
  }
  for (const filter of plan.filters) {
    const expression = dataset.columns[filter.column];
    if (!expression) throw new Error(`QueryPlan filter references an unknown semantic column: ${filter.column}`);
    appendFilter(conditions, parameters, expression, filter.operator, filter.value);
  }
  if (plan.timeRange) {
    if (!dataset.timeColumn) throw new Error("QueryPlan time range is not supported by the selected dataset");
    conditions.push(`${dataset.timeColumn} BETWEEN ? AND ?`);
    parameters.push(plan.timeRange.from, plan.timeRange.to);
  }

  let orderBy = "";
  if (plan.orderBy) {
    const match = /^([a-z_][a-z0-9_]*)(?:\s+(ASC|DESC))?$/iu.exec(plan.orderBy.trim());
    if (!match) throw new Error("Invalid QueryPlan ordering");
    const column = match[1];
    const metric = Object.values(dataset.metrics).find((item) => item.alias === column);
    const expression = dataset.columns[column] ?? metric?.expression;
    if (!expression) throw new Error(`QueryPlan ordering references an unknown field: ${column}`);
    orderBy = ` ORDER BY ${expression} ${match[2]?.toUpperCase() ?? "ASC"}`;
  }
  const limit = Math.min(Math.max(1, Math.trunc(plan.limit)), Math.max(1, Math.trunc(hardLimit)), 10_000);
  const sql = `SELECT ${selections.join(", ")} FROM ${dataset.from}${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""}${plan.metrics.length && groupBy.length ? ` GROUP BY ${groupBy.join(", ")}` : ""}${orderBy} LIMIT ${limit}`;
  return { plan: { ...plan, dimensions, limit }, sql, parameters, tables: dataset.tables };
}

function canonicalMetric(value: string): string {
  return value.replace(/\s+/gu, "").replace(/^([A-Za-z_]+)\(([^)]+)\)$/u, (_, fn: string, field: string) => `${fn.toUpperCase()}(${field.toLowerCase()})`);
}

function appendFilter(conditions: string[], parameters: unknown[], column: string, operator: QueryPlan["filters"][number]["operator"], value: string | string[]) {
  if (operator === "in") {
    if (!Array.isArray(value) || value.length === 0) throw new Error("QueryPlan IN filter requires a non-empty array");
    conditions.push(`${column} IN (${value.map(() => "?").join(", ")})`);
    parameters.push(...value);
    return;
  }
  if (Array.isArray(value)) throw new Error(`QueryPlan ${operator} filter requires a scalar value`);
  const sqlOperator = { eq: "=", ne: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "LIKE" }[operator];
  conditions.push(`${column} ${sqlOperator} ?`);
  parameters.push(value);
}
