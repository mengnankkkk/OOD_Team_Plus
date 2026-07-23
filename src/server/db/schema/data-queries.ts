import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { z } from "zod";

import { DATA_QUERY_STATUSES, OUTPUT_MODES } from "./enums";

const jsonTextSchema = z.string().trim().min(1);
const scalarValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const rowObjectSchema = z.record(z.string(), scalarValueSchema);

const dataQueryBaseSchema = z.object({
  id: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1).nullable().optional(),
  sourceMessageId: z.string().trim().min(1).nullable().optional(),
  agentRunId: z.string().trim().min(1),
  questionText: z.string().trim().min(1).max(2000),
  accountScopeJson: jsonTextSchema.nullable().optional(),
  requestedDatasetsJson: jsonTextSchema,
  outputMode: z.enum(OUTPUT_MODES),
  requestedLimit: z.number().int().min(1).max(10_000),
  status: z.enum(DATA_QUERY_STATUSES),
  planJson: jsonTextSchema.nullable().optional(),
  redactedSql: jsonTextSchema.nullable().optional(),
  parameterTypesJson: jsonTextSchema.nullable().optional(),
  safetyChecksJson: jsonTextSchema.nullable().optional(),
  columnMetadataJson: jsonTextSchema.nullable().optional(),
  rowCount: z.number().int().min(0).nullable().optional(),
  resultSizeBytes: z.number().int().min(0).nullable().optional(),
  isTruncated: z.boolean(),
  dataAsOf: jsonTextSchema.nullable().optional(),
  sourceSummaryJson: jsonTextSchema.nullable().optional(),
  failureCode: z.string().trim().min(1).nullable().optional(),
  failureMessage: z.string().trim().min(1).nullable().optional(),
  resultExpiresAt: jsonTextSchema.nullable().optional(),
  startedAt: jsonTextSchema.nullable().optional(),
  completedAt: jsonTextSchema.nullable().optional(),
  createdAt: jsonTextSchema,
});

export const dataQuerySelectSchema = dataQueryBaseSchema;

export const dataQueryInsertSchema = dataQueryBaseSchema.superRefine((value, ctx) => {
  if (value.status === "succeeded") {
    if (value.planJson == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["planJson"], message: "planJson is required for succeeded queries" });
    }

    if (value.redactedSql == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["redactedSql"], message: "redactedSql is required for succeeded queries" });
    }

    if (value.columnMetadataJson == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["columnMetadataJson"], message: "columnMetadataJson is required for succeeded queries" });
    }

    if (value.rowCount == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rowCount"], message: "rowCount is required for succeeded queries" });
    }

    if (value.completedAt == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["completedAt"], message: "completedAt is required for succeeded queries" });
    }

    if (value.failureCode != null || value.failureMessage != null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["failureCode"], message: "failure fields must be empty for succeeded queries" });
    }
  }

  if (value.status === "failed") {
    if (value.failureCode == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["failureCode"], message: "failureCode is required for failed queries" });
    }

    if (value.failureMessage == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["failureMessage"], message: "failureMessage is required for failed queries" });
    }

    if (value.completedAt == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["completedAt"], message: "completedAt is required for failed queries" });
    }
  }

  if ((value.status === "queued" || value.status === "running") && value.completedAt != null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["completedAt"], message: "completedAt must be empty until the query finishes" });
  }
});

const resultChunkBaseSchema = z.object({
  id: z.string().trim().min(1),
  queryId: z.string().trim().min(1),
  chunkNo: z.number().int().min(0),
  firstRowNo: z.number().int().min(0),
  rowCount: z.number().int().min(1).max(500),
  rowsJson: z.array(rowObjectSchema),
  contentSha256: z.string().trim().min(1),
  sizeBytes: z.number().int().min(1),
  createdAt: jsonTextSchema,
});

export const resultChunkSelectSchema = resultChunkBaseSchema;
export const resultChunkInsertSchema = resultChunkBaseSchema;

export const dataQueries = sqliteTable(
  "data_queries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    sessionId: text("session_id"),
    sourceMessageId: text("source_message_id"),
    agentRunId: text("agent_run_id").notNull().unique(),
    questionText: text("question_text").notNull(),
    accountScopeJson: text("account_scope_json"),
    requestedDatasetsJson: text("requested_datasets_json").notNull(),
    outputMode: text("output_mode", { enum: OUTPUT_MODES }).notNull(),
    requestedLimit: integer("requested_limit").notNull(),
    status: text("status", { enum: DATA_QUERY_STATUSES }).notNull().default("queued"),
    planJson: text("plan_json"),
    redactedSql: text("redacted_sql"),
    parameterTypesJson: text("parameter_types_json"),
    safetyChecksJson: text("safety_checks_json"),
    columnMetadataJson: text("column_metadata_json"),
    rowCount: integer("row_count"),
    resultSizeBytes: integer("result_size_bytes"),
    isTruncated: integer("is_truncated", { mode: "boolean" }).notNull().default(false),
    dataAsOf: text("data_as_of"),
    sourceSummaryJson: text("source_summary_json"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    resultExpiresAt: text("result_expires_at"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_dq_user_created").on(t.userId, t.createdAt),
    index("idx_dq_session_created").on(t.sessionId, t.createdAt),
    index("idx_dq_status_created").on(t.status, t.createdAt),
    uniqueIndex("idx_dq_agent_run").on(t.agentRunId),
  ],
);

export const dataQueryResultChunks = sqliteTable(
  "data_query_result_chunks",
  {
    id: text("id").primaryKey(),
    queryId: text("query_id").notNull(),
    chunkNo: integer("chunk_no").notNull(),
    firstRowNo: integer("first_row_no").notNull(),
    rowCount: integer("row_count").notNull(),
    rowsJson: text("rows_json").notNull(),
    contentSha256: text("content_sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_dqrc_query_chunk").on(t.queryId, t.chunkNo),
    uniqueIndex("idx_dqrc_query_firstrow").on(t.queryId, t.firstRowNo),
    index("idx_dqrc_query_id").on(t.queryId),
  ],
);

export type DataQueryInsert = z.infer<typeof dataQueryInsertSchema>;
export type DataQuerySelect = z.infer<typeof dataQuerySelectSchema>;
export type ResultChunkInsert = z.infer<typeof resultChunkInsertSchema>;
export type ResultChunkSelect = z.infer<typeof resultChunkSelectSchema>;
