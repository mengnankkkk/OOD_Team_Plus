export interface QueryPlan {
  domain?: string;
  sources?: QuerySource[];
  datasets: string[];
  dimensions: string[];
  metrics: string[];
  filters: QueryFilter[];
  timeRange?: { from: string; to: string };
  orderBy?: string;
  limit: number;
}

export interface QuerySource {
  dataset: string;
  kind?: "SQLITE" | "PANDADATA";
  table?: string;
  provider?: "LOCAL_DATABASE" | "PANDADATA";
  method?: string;
  parameters?: Record<string, unknown>;
  columns: string[];
  metrics?: string[];
  joinKeys?: string[];
}

export interface QueryFilter {
  column: string;
  operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "like";
  value: string | string[];
}
