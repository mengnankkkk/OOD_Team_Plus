export interface QueryPlan {
  datasets: string[];
  dimensions: string[];
  metrics: string[];
  filters: QueryFilter[];
  timeRange?: { from: string; to: string };
  orderBy?: string;
  limit: number;
}

export interface QueryFilter {
  column: string;
  operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "like";
  value: string | string[];
}
