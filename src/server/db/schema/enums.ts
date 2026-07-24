import { z } from "zod";

export const EXTENSION_RUN_TYPES = [
  "data_query",
  "artifact_generation",
  "branch_option_generation",
  "portfolio_refresh",
  "research_search",
  "rss_sync",
] as const;
export type ExtensionRunType = (typeof EXTENSION_RUN_TYPES)[number];

export const OUTPUT_MODES = ["sql_only", "chart", "financial_report"] as const;
export type OutputMode = (typeof OUTPUT_MODES)[number];

export const DATA_QUERY_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled", "interrupted"] as const;
export type DataQueryStatus = (typeof DATA_QUERY_STATUSES)[number];

export const ARTIFACT_TYPES = ["echarts_option", "markdown"] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export const ARTIFACT_STATUSES = ["generating", "ready", "failed", "deleted"] as const;
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

export const WORKSPACE_STATUSES = ["active", "archived"] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export const OPTION_BATCH_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled", "interrupted"] as const;
export type OptionBatchStatus = (typeof OPTION_BATCH_STATUSES)[number];

export const BRANCH_EVENT_TYPES = ["root_created", "option_executed", "branch_switched", "undo"] as const;
export type BranchEventType = (typeof BRANCH_EVENT_TYPES)[number];

export const SEARCH_STATUSES = ["queued", "running", "succeeded", "partial", "failed", "cancelled", "interrupted"] as const;
export type SearchStatus = (typeof SEARCH_STATUSES)[number];

export const SEARCH_ADAPTERS = ["web", "mcp", "knowledge_base", "rss"] as const;
export type SearchAdapter = (typeof SEARCH_ADAPTERS)[number];

export const SOURCE_STATUSES = ["succeeded", "failed", "skipped"] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const NOTIFICATION_SEVERITIES = ["information", "attention", "important", "urgent"] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const NOTIFICATION_MODES = ["important_only", "daily_digest", "muted"] as const;
export type NotificationMode = (typeof NOTIFICATION_MODES)[number];

export const RSS_FEED_STATUSES = ["active", "disabled", "error", "deleted"] as const;
export type RssFeedStatus = (typeof RSS_FEED_STATUSES)[number];

const ENUM_TABLES = {
  extension_run_type: EXTENSION_RUN_TYPES,
  output_mode: OUTPUT_MODES,
  data_query_status: DATA_QUERY_STATUSES,
  artifact_type: ARTIFACT_TYPES,
  artifact_status: ARTIFACT_STATUSES,
  workspace_status: WORKSPACE_STATUSES,
  option_batch_status: OPTION_BATCH_STATUSES,
  branch_event_type: BRANCH_EVENT_TYPES,
  search_status: SEARCH_STATUSES,
  search_adapter: SEARCH_ADAPTERS,
  source_status: SOURCE_STATUSES,
  notification_severity: NOTIFICATION_SEVERITIES,
  notification_mode: NOTIFICATION_MODES,
  rss_feed_status: RSS_FEED_STATUSES,
} as const;

export type EnumTableName = keyof typeof ENUM_TABLES;

const ENUM_SET_MAP = Object.fromEntries(
  Object.entries(ENUM_TABLES).map(([table, values]) => [table, new Set(values)]),
) as unknown as Record<EnumTableName, ReadonlySet<string>>;

function assertEnumTable(table: string): asserts table is EnumTableName {
  if (!(table in ENUM_TABLES)) {
    throw new Error(`Unknown enum table: ${table}`);
  }
}

function assertEnumValue(table: EnumTableName, value: string): void {
  if (!ENUM_SET_MAP[table].has(value)) {
    throw new Error(`Unknown value for ${table}: ${value}`);
  }
}

export function toApiEnum(table: EnumTableName, dbValue: string): string {
  assertEnumTable(table);
  assertEnumValue(table, dbValue);

  return dbValue.toUpperCase().replace(/-/g, "_");
}

export function fromApiEnum(table: EnumTableName, apiValue: string): string {
  assertEnumTable(table);

  const dbValue = apiValue.toLowerCase().replace(/-/g, "_");
  assertEnumValue(table, dbValue);

  return dbValue;
}

export const extensionEnumSchema = {
  extensionRunType: z.enum(EXTENSION_RUN_TYPES),
  outputMode: z.enum(OUTPUT_MODES),
  dataQueryStatus: z.enum(DATA_QUERY_STATUSES),
  artifactType: z.enum(ARTIFACT_TYPES),
  artifactStatus: z.enum(ARTIFACT_STATUSES),
  workspaceStatus: z.enum(WORKSPACE_STATUSES),
  optionBatchStatus: z.enum(OPTION_BATCH_STATUSES),
  branchEventType: z.enum(BRANCH_EVENT_TYPES),
  searchStatus: z.enum(SEARCH_STATUSES),
  searchAdapter: z.enum(SEARCH_ADAPTERS),
  sourceStatus: z.enum(SOURCE_STATUSES),
  notificationSeverity: z.enum(NOTIFICATION_SEVERITIES),
  notificationMode: z.enum(NOTIFICATION_MODES),
  rssFeedStatus: z.enum(RSS_FEED_STATUSES),
} as const;
