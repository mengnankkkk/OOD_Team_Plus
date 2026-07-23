import { z } from "zod";

export const OutputModeSchema = z.enum(["SQL_ONLY", "CHART", "FINANCIAL_REPORT"]);
export type OutputMode = z.infer<typeof OutputModeSchema>;

export const GeneratedArtifactTypeSchema = z.enum(["ECHARTS_OPTION", "MARKDOWN"]);
export type GeneratedArtifactType = z.infer<typeof GeneratedArtifactTypeSchema>;

export const GeneratedArtifactStatusSchema = z.enum(["GENERATING", "READY", "FAILED", "DELETED"]);
export type GeneratedArtifactStatus = z.infer<typeof GeneratedArtifactStatusSchema>;

export const AnalysisStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "WAITING_FOR_USER",
  "COMPLETED",
  "BLOCKED",
  "FAILED",
  "CANCELLED",
  "INTERRUPTED",
]);
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;

export const ExtensionAnalysisTypeSchema = z.enum([
  "DATA_QUERY",
  "ARTIFACT_GENERATION",
  "BRANCH_OPTION_GENERATION",
  "PORTFOLIO_REFRESH",
  "RESEARCH_SEARCH",
  "RSS_SYNC",
]);
export type ExtensionAnalysisType = z.infer<typeof ExtensionAnalysisTypeSchema>;

export const ExtensionRunRefSchema = z.object({
  analysisId: z.string(),
  type: ExtensionAnalysisTypeSchema,
  status: AnalysisStatusSchema,
  streamUrl: z.string(),
});
export type ExtensionRunRef = z.infer<typeof ExtensionRunRefSchema>;

export const DataQueryRequestSchema = z.object({
  questionText: z.string().min(1).max(2000),
  requestedDatasets: z.array(z.string()).min(1),
  outputMode: OutputModeSchema,
  requestedLimit: z.number().int().min(1).max(10000).default(2000),
  accountScope: z.array(z.string()).optional(),
  conversationId: z.string().optional(),
  messageId: z.string().optional(),
});
export type DataQueryRequest = z.infer<typeof DataQueryRequestSchema>;

export const GeneratedArtifactRequestSchema = z
  .object({
    artifactType: GeneratedArtifactTypeSchema,
    title: z.string().min(1).max(120),
    sourceMessageId: z.string().optional(),
    sourceQueryId: z.string().optional(),
    conversationId: z.string().optional(),
  })
  .refine((data) => data.sourceMessageId != null || data.sourceQueryId != null, {
    message: "At least one of sourceMessageId or sourceQueryId must be provided",
  });
export type GeneratedArtifactRequest = z.infer<typeof GeneratedArtifactRequestSchema>;

export const SimulationWorkspaceRequestSchema = z.object({
  label: z.string().min(1).max(200),
  objectiveText: z.string().min(1),
  portfolioSnapshotId: z.string(),
  conversationSessionId: z.string().optional(),
  recommendationId: z.string().optional(),
});
export type SimulationWorkspaceRequest = z.infer<typeof SimulationWorkspaceRequestSchema>;

export const PaginationMetaSchema = z.object({
  limit: z.number(),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export const ApiMetaSchema = z.object({
  requestId: z.string(),
  apiVersion: z.literal("v1"),
  generatedAt: z.string(),
  pagination: PaginationMetaSchema.optional(),
});

export const IdempotencyKeySchema = z.string().min(1).max(255);
