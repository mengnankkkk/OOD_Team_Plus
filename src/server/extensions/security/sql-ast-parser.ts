import { Parser } from "node-sql-parser";

const parser = new Parser();

const ALLOWED_TABLES = new Set([
  "portfolio_snapshots",
  "holding_snapshots",
  "market_snapshots",
  "market_snapshot_metrics",
  "portfolio_score_snapshots",
  "instruments",
  "data_queries",
  "data_query_result_chunks",
]);

const ALLOWED_FUNCTIONS = new Set([
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "round",
  "abs",
  "coalesce",
  "date",
  "strftime",
  "julianday",
  "cast",
  "ifnull",
  "nullif",
  "lower",
  "upper",
  "trim",
  "length",
  "substr",
  "replace",
  "group_concat",
  "json_extract",
  "json_object",
  "json_group_array",
  "row_number",
  "rank",
  "dense_rank",
  "lag",
  "lead",
]);

const FORBIDDEN_KEYWORDS = [
  "PRAGMA",
  "ATTACH",
  "DETACH",
  "CREATE",
  "DROP",
  "ALTER",
  "INSERT",
  "UPDATE",
  "DELETE",
  "REPLACE",
  "TRUNCATE",
];

export interface SqlValidationResult {
  valid: boolean;
  errors: string[];
  statementType?: string;
}

export function validateSql(
  sql: string,
  allowedTables: ReadonlySet<string> = ALLOWED_TABLES,
): SqlValidationResult {
  const trimmedSql = sql.trim();
  if (hasMultipleStatements(trimmedSql)) {
    return { valid: false, errors: ["Multiple statements not allowed"] };
  }
  if (/--|\/\*|\*\//u.test(sql)) {
    return { valid: false, errors: ["SQL comments not allowed"] };
  }

  let parsed: ReturnType<Parser["astify"]>;
  try {
    parsed = parser.astify(sql, { database: "SQLite" });
  } catch {
    return { valid: false, errors: ["SQL parse error"] };
  }

  if (Array.isArray(parsed) && parsed.length !== 1) {
    return { valid: false, errors: ["Multiple statements not allowed"] };
  }
  const statement = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!statement || statement.type !== "select") {
    return { valid: false, errors: ["Only SELECT statements are allowed"] };
  }

  const errors = validateAst(statement, allowedTables);
  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, "iu").test(stripStringLiterals(sql))) {
      errors.push(`Forbidden keyword: ${keyword}`);
    }
  }

  return errors.length === 0
    ? { valid: true, errors: [], statementType: "select" }
    : { valid: false, errors, statementType: "select" };
}

function hasMultipleStatements(sql: string): boolean {
  const withoutTrailingTerminator = sql.endsWith(";") ? sql.slice(0, -1) : sql;
  return withoutTrailingTerminator.includes(";");
}

function validateAst(statement: object, allowedTables: ReadonlySet<string>): string[] {
  const tables = new Set<string>();
  const functions = new Set<string>();

  walkAst(statement, (node) => {
    if (typeof node.table === "string") tables.add(node.table);
    const functionName = getFunctionName(node);
    if (functionName) functions.add(functionName);
  });

  return [
    ...[...tables]
      .filter((table) => !allowedTables.has(table.toLowerCase()))
      .map((table) => `Table not in whitelist: ${table}`),
    ...[...functions]
      .filter((name) => !ALLOWED_FUNCTIONS.has(name.toLowerCase()))
      .map((name) => `Function not in whitelist: ${name}`),
  ];
}

function walkAst(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => walkAst(item, visit));
    return;
  }

  const node = value as Record<string, unknown>;
  visit(node);
  Object.values(node).forEach((child) => walkAst(child, visit));
}

function getFunctionName(node: Record<string, unknown>): string | undefined {
  if (node.type !== "function" && node.type !== "aggr_func" && node.type !== "window_func") return;
  if (typeof node.name === "string") return node.name;
  if (node.name && typeof node.name === "object") {
    const name = node.name as Record<string, unknown>;
    if (typeof name.name === "string") return name.name;
    if (Array.isArray(name.name)) {
      const part = name.name.at(-1);
      if (part && typeof part === "object" && "value" in part && typeof part.value === "string") {
        return part.value;
      }
    }
  }
}

function stripStringLiterals(sql: string): string {
  return sql.replace(/'(?:''|[^'])*'/gu, "''").replace(/"(?:""|[^"])*"/gu, '""');
}

export { ALLOWED_FUNCTIONS, ALLOWED_TABLES };
