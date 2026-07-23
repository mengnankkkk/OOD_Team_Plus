import { z } from "zod";

import {
  ALLOWED_FUNCTIONS,
  ALLOWED_TABLES,
  validateSql,
} from "../security/sql-ast-parser";
import type { QueryFilter, QueryPlan } from "./types";

const QueryPlanSchema = z.object({
  datasets: z.array(z.string()),
  dimensions: z.array(z.string()),
  metrics: z.array(z.string()),
  filters: z.array(
    z.object({
      column: z.string(),
      operator: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "in", "like"]),
      value: z.union([z.string(), z.array(z.string())]),
    }),
  ),
  timeRange: z.object({ from: z.string(), to: z.string() }).optional(),
  orderBy: z.string().optional(),
  limit: z.number().int().min(1).max(10_000).default(2_000),
});

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const METRIC_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)\((\*|[A-Za-z_][A-Za-z0-9_]*)\)$/u;
const FILTER_OPERATORS: Record<Exclude<QueryFilter["operator"], "in">, string> = {
  eq: "=",
  ne: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  like: "LIKE",
};

export async function generateQueryPlan(
  question: string,
  requestedDatasets: string[],
  accountScope: string[] | null,
  userId: string,
): Promise<{ plan: QueryPlan; sql: string }> {
  const availableDatasets = requestedDatasets.filter((dataset) => ALLOWED_TABLES.has(dataset));
  const rawPlan = await callDeepSeekForPlan(question, buildSystemPrompt(availableDatasets));
  const plan = QueryPlanSchema.parse(rawPlan);
  const sql = planToSql(plan, userId, accountScope, new Set(availableDatasets));

  return { plan, sql };
}

function buildSystemPrompt(datasets: string[]): string {
  return `You are a SQL query plan generator for a financial portfolio system.
Available datasets: ${datasets.join(", ")}
Use only these dataset keys. Generate a structured JSON query plan with dimensions, metrics, filters, timeRange, and limit.
Metrics may use only approved SQL aggregate functions. Response must be valid JSON matching the QueryPlan schema. No explanation, only JSON.`;
}

async function callDeepSeekForPlan(question: string, systemPrompt: string): Promise<unknown> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const apiUrl =
    process.env.DEEPSEEK_API_URL?.trim() ?? "https://api.deepseek.com/v1/chat/completions";
  const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";

  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY not configured");
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    }),
  });

  if (!response.ok) {
    throw new Error(`DeepSeek API error: ${response.status}`);
  }

  const data: unknown = await response.json();
  const content = z
    .object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) })
    .parse(data).choices[0].message.content;
  return JSON.parse(content) as unknown;
}

function planToSql(
  plan: QueryPlan,
  userId: string,
  accountScope: string[] | null,
  availableDatasets: ReadonlySet<string>,
): string {
  const tables = plan.datasets.filter(
    (dataset) => ALLOWED_TABLES.has(dataset) && availableDatasets.has(dataset),
  );
  if (tables.length === 0) throw new Error("No valid tables in query plan");

  const dimensions = plan.dimensions.map(safeIdentifier);
  const metrics = plan.metrics.map(safeMetric);
  const selectClause = [...dimensions, ...metrics].join(", ") || "*";
  const conditions = [`user_id = ${sqlLiteral(userId)}`];

  if (accountScope?.length) {
    conditions.push(`account_id IN (${accountScope.map(sqlLiteral).join(",")})`);
  }
  conditions.push(...plan.filters.map(filterToSql));

  const clauses = [
    `SELECT ${selectClause} FROM ${tables[0]}`,
    `WHERE ${conditions.join(" AND ")}`,
    dimensions.length ? `GROUP BY ${dimensions.join(", ")}` : "",
    plan.orderBy ? `ORDER BY ${safeOrderBy(plan.orderBy)}` : "",
    `LIMIT ${plan.limit}`,
  ];
  const sql = clauses.filter(Boolean).join(" ");
  if (!validateSql(sql, new Set([tables[0]])).valid) {
    throw new Error("Generated query failed SQL security validation");
  }
  return sql;
}

function safeIdentifier(value: string): string {
  if (!IDENTIFIER_PATTERN.test(value)) throw new Error("Invalid query plan identifier");
  return value;
}

function safeMetric(value: string): string {
  const match = METRIC_PATTERN.exec(value);
  if (!match || !ALLOWED_FUNCTIONS.has(match[1].toLowerCase())) {
    throw new Error("Invalid query plan metric");
  }
  return `${match[1].toUpperCase()}(${match[2] === "*" ? "*" : safeIdentifier(match[2])})`;
}

function safeOrderBy(value: string): string {
  return value.split(",").map((part) => {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)(?:\s+(ASC|DESC))?\s*$/iu.exec(part);
    if (!match) throw new Error("Invalid query plan orderBy");
    return `${safeIdentifier(match[1])}${match[2] ? ` ${match[2].toUpperCase()}` : ""}`;
  }).join(", ");
}

function filterToSql(filter: QueryFilter): string {
  const column = safeIdentifier(filter.column);
  if (filter.operator === "in") {
    if (!Array.isArray(filter.value) || filter.value.length === 0) {
      throw new Error("IN filter requires a non-empty array");
    }
    return `${column} IN (${filter.value.map(sqlLiteral).join(",")})`;
  }
  if (typeof filter.value !== "string") throw new Error("Filter requires a string value");
  return `${column} ${FILTER_OPERATORS[filter.operator]} ${sqlLiteral(filter.value)}`;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
