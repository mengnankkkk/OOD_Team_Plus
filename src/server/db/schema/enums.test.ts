import { describe, expect, it } from "vitest";

import {
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES,
  BRANCH_EVENT_TYPES,
  DATA_QUERY_STATUSES,
  EXTENSION_RUN_TYPES,
  NOTIFICATION_MODES,
  NOTIFICATION_SEVERITIES,
  OPTION_BATCH_STATUSES,
  OUTPUT_MODES,
  RSS_FEED_STATUSES,
  SEARCH_ADAPTERS,
  SEARCH_STATUSES,
  SOURCE_STATUSES,
  WORKSPACE_STATUSES,
  fromApiEnum,
  toApiEnum,
} from "./enums";

const enumCases = [
  { table: "extension_run_type", value: EXTENSION_RUN_TYPES[0], api: "DATA_QUERY" },
  { table: "output_mode", value: OUTPUT_MODES[0], api: "SQL_ONLY" },
  { table: "data_query_status", value: DATA_QUERY_STATUSES[0], api: "QUEUED" },
  { table: "artifact_type", value: ARTIFACT_TYPES[0], api: "ECHARTS_OPTION" },
  { table: "artifact_status", value: ARTIFACT_STATUSES[0], api: "GENERATING" },
  { table: "workspace_status", value: WORKSPACE_STATUSES[0], api: "ACTIVE" },
  { table: "option_batch_status", value: OPTION_BATCH_STATUSES[0], api: "QUEUED" },
  { table: "branch_event_type", value: BRANCH_EVENT_TYPES[0], api: "ROOT_CREATED" },
  { table: "search_status", value: SEARCH_STATUSES[0], api: "QUEUED" },
  { table: "search_adapter", value: SEARCH_ADAPTERS[0], api: "WEB" },
  { table: "source_status", value: SOURCE_STATUSES[0], api: "SUCCEEDED" },
  { table: "notification_severity", value: NOTIFICATION_SEVERITIES[0], api: "INFORMATION" },
  { table: "notification_mode", value: NOTIFICATION_MODES[0], api: "IMPORTANT_ONLY" },
  { table: "rss_feed_status", value: RSS_FEED_STATUSES[0], api: "ACTIVE" },
] as const;

describe("enum mapping", () => {
  it.each(enumCases)("toApiEnum converts $value to $api", ({ table, value, api }) => {
    expect(toApiEnum(table, value)).toBe(api);
  });

  it.each(enumCases)("fromApiEnum converts $api to $value", ({ table, value, api }) => {
    expect(fromApiEnum(table, api)).toBe(value);
  });
});
