import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { z } from "zod";

import { ARTIFACT_STATUSES, ARTIFACT_TYPES } from "./enums";

const ECHARTS_MAX_BYTES = 512 * 1024;
const MARKDOWN_MAX_BYTES = 1024 * 1024;

const textEncoder = new TextEncoder();

function byteLength(value: string): number {
  return textEncoder.encode(value).length;
}

const artifactTypeSchema = z.enum(ARTIFACT_TYPES);
const artifactStatusSchema = z.enum(ARTIFACT_STATUSES);

const nullableText = z.string().trim().min(1).nullable();

export const generatedArtifacts = sqliteTable(
  "generated_artifacts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    sessionId: text("session_id"),
    sourceMessageId: text("source_message_id"),
    sourceQueryId: text("source_query_id"),
    agentRunId: text("agent_run_id").notNull(),
    artifactType: text("artifact_type", { enum: ARTIFACT_TYPES }).notNull(),
    status: text("status", { enum: ARTIFACT_STATUSES }).notNull().default("generating"),
    title: text("title").notNull(),
    currentVersionNo: integer("current_version_no").notNull().default(0),
    sourceSnapshotJson: text("source_snapshot_json").notNull(),
    sourceSnapshotSha256: text("source_snapshot_sha256").notNull(),
    provenanceJson: text("provenance_json").notNull(),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    readyAt: text("ready_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (t) => [
    index("idx_ga_user_created").on(t.userId, t.createdAt),
    index("idx_ga_source_msg").on(t.sourceMessageId),
    index("idx_ga_source_query").on(t.sourceQueryId),
    index("idx_ga_agent_run").on(t.agentRunId),
  ],
);

export const generatedArtifactVersions = sqliteTable(
  "generated_artifact_versions",
  {
    id: text("id").primaryKey(),
    artifactId: text("artifact_id").notNull(),
    versionNo: integer("version_no").notNull(),
    contentType: text("content_type", { enum: ARTIFACT_TYPES }).notNull(),
    contentJson: text("content_json"),
    contentMarkdown: text("content_markdown"),
    contentSha256: text("content_sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdByType: text("created_by_type").notNull().default("system"),
    createdById: text("created_by_id"),
    editedBy: text("edited_by"),
    editNote: text("edit_note"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("idx_gav_artifact_version").on(t.artifactId, t.versionNo)],
);

export const messageArtifacts = sqliteTable(
  "message_artifacts",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id").notNull(),
    artifactType: text("artifact_type").notNull(),
    riskAssessmentId: text("risk_assessment_id"),
    goalId: text("goal_id"),
    portfolioSnapshotId: text("portfolio_snapshot_id"),
    diagnosticRunId: text("diagnostic_run_id"),
    recommendationId: text("recommendation_id"),
    simulationId: text("simulation_id"),
    generatedArtifactId: text("generated_artifact_id"),
    displayOrder: integer("display_order").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_message_artifacts_message").on(t.messageId),
    index("idx_message_artifacts_generated").on(t.generatedArtifactId),
    uniqueIndex("idx_message_artifacts_type_order").on(t.messageId, t.artifactType, t.displayOrder),
  ],
);

const generatedArtifactBaseSchema = z.object({
  id: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1).nullable().optional(),
  sourceMessageId: z.string().trim().min(1).nullable().optional(),
  sourceQueryId: z.string().trim().min(1).nullable().optional(),
  agentRunId: z.string().trim().min(1),
  artifactType: artifactTypeSchema,
  status: artifactStatusSchema.default("generating"),
  title: z.string().trim().min(1).max(120),
  currentVersionNo: z.number().int().min(0).default(0),
  sourceSnapshotJson: z.string().trim().min(1),
  sourceSnapshotSha256: z.string().trim().min(1),
  provenanceJson: z.string().trim().min(1),
  failureCode: z.string().trim().min(1).nullable().optional(),
  failureMessage: z.string().trim().min(1).nullable().optional(),
  readyAt: z.string().trim().min(1).nullable().optional(),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
  deletedAt: z.string().trim().min(1).nullable().optional(),
  rowVersion: z.number().int().min(1).default(1),
});

export const generatedArtifactSelectSchema = generatedArtifactBaseSchema;

export const generatedArtifactInsertSchema = generatedArtifactBaseSchema.superRefine((value, ctx) => {
  if (value.sourceMessageId == null && value.sourceQueryId == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one of sourceMessageId or sourceQueryId is required.",
      path: ["sourceMessageId"],
    });
  }

  if (value.status === "ready") {
    if (value.currentVersionNo < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ready status requires currentVersionNo >= 1.",
        path: ["currentVersionNo"],
      });
    }

    if (value.readyAt == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ready status requires readyAt.",
        path: ["readyAt"],
      });
    }

    if (value.failureCode != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ready status must not include failureCode.",
        path: ["failureCode"],
      });
    }
  }

  if (value.status === "failed" && value.failureCode == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "failed status requires failureCode.",
      path: ["failureCode"],
    });
  }

  if (value.status === "deleted" && value.deletedAt == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "deleted status requires deletedAt.",
      path: ["deletedAt"],
    });
  }
});

const versionContentSchema = z.object({
  id: z.string().trim().min(1),
  artifactId: z.string().trim().min(1),
  versionNo: z.number().int().min(1),
  contentType: artifactTypeSchema,
  contentJson: nullableText.optional(),
  contentMarkdown: nullableText.optional(),
  contentSha256: z.string().trim().regex(/^[a-f0-9]{64}$/u).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  createdByType: z.string().trim().min(1).default("system"),
  createdById: z.string().trim().min(1).nullable().optional(),
  editedBy: z.string().trim().min(1).nullable().optional(),
  editNote: z.string().trim().min(1).nullable().optional(),
  createdAt: z.string().trim().min(1),
});

export const versionInsertSchema = versionContentSchema.superRefine((value, ctx) => {
  const hasJson = value.contentJson != null;
  const hasMarkdown = value.contentMarkdown != null;

  if (hasJson === hasMarkdown) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Exactly one of contentJson or contentMarkdown must be set.",
      path: [hasJson ? "contentMarkdown" : "contentJson"],
    });
  }

  if (value.contentType === "echarts_option") {
    if (!hasJson || hasMarkdown) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "echarts_option versions require contentJson only.",
        path: ["contentJson"],
      });
    }

    if (hasJson && byteLength(value.contentJson!) > ECHARTS_MAX_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "contentJson must be at most 512 KiB.",
        path: ["contentJson"],
      });
    }
  }

  if (value.contentType === "markdown") {
    if (!hasMarkdown || hasJson) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "markdown versions require contentMarkdown only.",
        path: ["contentMarkdown"],
      });
    }

    if (hasMarkdown && byteLength(value.contentMarkdown!) > MARKDOWN_MAX_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "contentMarkdown must be at most 1 MiB.",
        path: ["contentMarkdown"],
      });
    }
  }
});

export type GeneratedArtifactInsert = z.infer<typeof generatedArtifactInsertSchema>;
export type GeneratedArtifactSelect = z.infer<typeof generatedArtifactSelectSchema>;
export type VersionInsert = z.infer<typeof versionInsertSchema>;
