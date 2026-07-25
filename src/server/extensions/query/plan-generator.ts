import { ALLOWED_TABLES, validateSql } from "../security/sql-ast-parser";
import type { QueryPlan } from "./types";
import { z } from "zod";
import { compileSemanticPlan, SEMANTIC_DATASETS, type SemanticDatasetKey } from "./semantic-catalog";
import { asQuerySource, buildPandaQuerySource, isMarketDataset, type MarketDatasetKey, type PandaQuerySource } from "./market-catalog";
import { canonicalizeManagedPlan, loadManagedSemanticContext, type ManagedSemanticContext } from "./managed-semantic-catalog";
import type { SqliteDb } from "@/server/db/client.runtime";

type DatasetKey = SemanticDatasetKey | MarketDatasetKey;

export interface GeneratedQueryPlan {
  plan: QueryPlan;
  sql: string | null;
  parameters: unknown[];
  pandaSources: PandaQuerySource[];
  planner: "SEMANTIC_MODEL" | "DETERMINISTIC_FALLBACK";
}

const SemanticPlanSchema = z.object({
  domain: z.string().min(1).max(80).optional(),
  datasets: z.array(z.string()).min(1),
  sources: z.array(z.object({ dataset: z.string(), table: z.string().optional(), columns: z.array(z.string()), metrics: z.array(z.string()).optional() })).optional(),
  dimensions: z.array(z.string()).default([]),
  metrics: z.array(z.string()).default([]),
  filters: z.array(z.object({ column: z.string(), operator: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "in", "like"]), value: z.union([z.string(), z.array(z.string())]) })).default([]),
  timeRange: z.object({ from: z.string(), to: z.string() }).optional(),
  orderBy: z.string().optional(),
  limit: z.number().int().min(1).max(10_000).default(2_000),
});

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
  MARKET_STOCK_DAILY: "MARKET_STOCK_DAILY",
  MARKET_FUND_DAILY: "MARKET_FUND_DAILY",
  MARKET_INDEX_DAILY: "MARKET_INDEX_DAILY",
  MARKET_US_DAILY: "MARKET_US_DAILY",
  MARKET_HK_DAILY: "MARKET_HK_DAILY",
  stock_daily: "MARKET_STOCK_DAILY",
  fund_daily: "MARKET_FUND_DAILY",
  index_daily: "MARKET_INDEX_DAILY",
  us_daily: "MARKET_US_DAILY",
  hk_daily: "MARKET_HK_DAILY",
};

export async function generateQueryPlan(
  question: string,
  requestedDatasets: string[],
  accountScope: string[] | null,
  userId: string,
  requestedLimit = 2_000,
  semanticDb?: SqliteDb,
): Promise<GeneratedQueryPlan> {
  const datasets = normalizeDatasets(requestedDatasets);
  if (datasets.length === 0) throw new Error("No valid datasets were requested");

  const marketDatasets = datasets.filter(isMarketDataset);
  if (marketDatasets.length) {
    const localDatasets = datasets.filter((dataset): dataset is SemanticDatasetKey => !isMarketDataset(dataset));
    const local = localDatasets.length
      ? await generateQueryPlan(question, localDatasets, accountScope, userId, requestedLimit, semanticDb)
      : null;
    const pandaSources = marketDatasets.map((dataset) => buildPandaQuerySource(question, dataset));
    const plan: QueryPlan = {
      domain: "market_and_portfolio",
      datasets,
      sources: [
        ...(local?.plan.sources ?? (local ? [{ dataset: local.plan.datasets[0], kind: "SQLITE" as const, provider: "LOCAL_DATABASE" as const, columns: local.plan.dimensions, metrics: local.plan.metrics }] : [])),
        ...pandaSources.map(asQuerySource),
      ],
      dimensions: local?.plan.dimensions ?? pandaSources[0].columns,
      metrics: local?.plan.metrics ?? [],
      filters: local?.plan.filters ?? [],
      limit: Math.min(Math.max(Math.trunc(requestedLimit), 1), 10_000),
    };
    return {
      plan,
      sql: local?.sql ?? null,
      parameters: local?.parameters ?? [],
      pandaSources,
      planner: local?.planner ?? "DETERMINISTIC_FALLBACK",
    };
  }

  const localDatasets = datasets as SemanticDatasetKey[];
  const semanticContext = loadManagedSemanticContext(semanticDb);
  const modelPlan = await requestSemanticPlan(question, localDatasets, requestedLimit, semanticContext);
  const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 10_000);
  const plan = modelPlan
    ? validateModelPlan(modelPlan, localDatasets, limit, semanticContext)
    : createDefaultSemanticPlan(localDatasets[0], limit);
  const compiled = compileSemanticPlan(plan, userId, accountScope, limit);
  const generated = { plan: compiled.plan, sql: compiled.sql, parameters: compiled.parameters };

  const allowedTables = new Set(compiled.tables);
  const validation = validateSql(generated.sql, allowedTables);
  if (!validation.valid) throw new Error(`Generated query failed SQL security validation: ${validation.errors.join("; ") || "unknown"}`);
  return { ...generated, pandaSources: [], planner: modelPlan ? "SEMANTIC_MODEL" : "DETERMINISTIC_FALLBACK" };
}

function createDefaultSemanticPlan(dataset: SemanticDatasetKey, limit: number): QueryPlan {
  const definition = SEMANTIC_DATASETS[dataset];
  return {
    domain: "portfolio",
    datasets: [dataset],
    sources: [{
      dataset,
      kind: "SQLITE",
      provider: "LOCAL_DATABASE",
      table: definition.tables[0],
      columns: definition.defaultDimensions,
      metrics: [],
    }],
    dimensions: definition.defaultDimensions,
    metrics: [],
    filters: [],
    orderBy: definition.timeColumn ? `${defaultOrderColumn(dataset)} DESC` : undefined,
    limit,
  };
}

function defaultOrderColumn(dataset: SemanticDatasetKey): string {
  if (dataset === "PORTFOLIO_METRICS") return "computed_at";
  return "as_of";
}

async function requestSemanticPlan(question: string, datasets: SemanticDatasetKey[], requestedLimit: number, semanticContext: ManagedSemanticContext | null): Promise<QueryPlan | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) return null;
  let content: string | undefined;
  try {
    const response = await fetch(process.env.DEEPSEEK_API_URL ?? "https://api.deepseek.com/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat", temperature: 0, response_format: { type: "json_object" }, messages: [
        { role: "system", content: "Return only a JSON QueryPlan. Select only the provided semantic datasets. Never emit SQL." },
        { role: "user", content: JSON.stringify({ question, allowedDatasets: datasets, semanticLayer: semanticContext, requestedLimit }) },
      ] }),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    content = payload.choices?.[0]?.message?.content;
  } catch {
    return null;
  }
  if (!content) return null;
  let rawPlan: unknown;
  try {
    rawPlan = JSON.parse(content);
  } catch {
    return null;
  }
  const parsed = SemanticPlanSchema.safeParse(rawPlan);
  if (!parsed.success) return null;
  if (parsed.data.datasets.some((dataset) => {
    const normalized = normalizeDatasets([dataset])[0];
    return !normalized || isMarketDataset(normalized) || !datasets.includes(normalized);
  })) throw new Error("QueryPlan references a dataset that was not requested");
  return parsed.data;
}

function validateModelPlan(plan: QueryPlan, requested: SemanticDatasetKey[], limit: number, semanticContext: ManagedSemanticContext | null): QueryPlan {
  const datasets = normalizeDatasets(plan.datasets) as SemanticDatasetKey[];
  if (!datasets.length || datasets.some((dataset) => !requested.includes(dataset))) throw new Error("QueryPlan references a dataset that was not requested");
  if (datasets.length !== 1) throw new Error("QueryPlan must select one primary dataset");
  const canonicalPlan = canonicalizeManagedPlan(plan, datasets[0], semanticContext);
  const dimensions = canonicalPlan.dimensions.filter((column) => /^[a-z_][a-z0-9_]*$/u.test(column));
  const metrics = canonicalPlan.metrics.filter((metric) => /^[A-Z_]+\([a-z_*][a-z0-9_*]*\)$/u.test(metric));
  if (dimensions.length !== canonicalPlan.dimensions.length) throw new Error("Invalid query plan identifier");
  if (metrics.length !== canonicalPlan.metrics.length) throw new Error("Invalid query plan metric");
  const dataset = SEMANTIC_DATASETS[datasets[0]];
  for (const filter of canonicalPlan.filters) if (!dataset.columns[filter.column]) throw new Error(`QueryPlan filter references an unknown semantic column: ${filter.column}`);
  return { ...canonicalPlan, datasets, dimensions, metrics, limit: Math.min(canonicalPlan.limit, limit) };
}

function normalizeDatasets(values: string[]): DatasetKey[] {
  return [...new Set(values.flatMap((value) => {
    const normalized = DATASET_ALIASES[value] ?? DATASET_ALIASES[value.toUpperCase()];
    return normalized ? [normalized] : [];
  }))];
}

export function assertQueryCatalog(): void {
  for (const dataset of Object.values(SEMANTIC_DATASETS)) {
    for (const table of dataset.tables) if (!ALLOWED_TABLES.has(table)) throw new Error(`Dataset table is not allowlisted: ${table}`);
  }
}
