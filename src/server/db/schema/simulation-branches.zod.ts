import { z } from "zod";

import { BRANCH_EVENT_TYPES, OPTION_BATCH_STATUSES, WORKSPACE_STATUSES } from "./enums";

const nonEmptyText = z.string().trim().min(1);
const decimalText = z.string().trim().min(1).refine((value) => Number.isFinite(Number(value)), "Must be a decimal string.");
const nonNegativeDecimalText = decimalText.refine((value) => Number(value) >= 0, "Must be greater than or equal to 0.");

const branchStatusSchema = z.enum(["active", "archived", "discarded"] as const);

const workspaceShape = {
  id: nonEmptyText,
  userId: nonEmptyText,
  portfolioSnapshotId: nonEmptyText,
  conversationSessionId: nonEmptyText.nullable().optional(),
  recommendationId: nonEmptyText.nullable().optional(),
  status: z.enum(WORKSPACE_STATUSES),
  label: z.string().trim().min(1).max(200),
  objectiveText: nonEmptyText,
  rootBranchId: nonEmptyText,
  activeBranchId: nonEmptyText,
  createdAt: nonEmptyText,
  updatedAt: nonEmptyText,
  deletedAt: nonEmptyText.nullable().optional(),
  rowVersion: z.number().int().min(1),
} as const;

const branchShape = {
  id: nonEmptyText,
  workspaceId: nonEmptyText,
  parentBranchId: nonEmptyText.nullable().optional(),
  parentOptionId: nonEmptyText.nullable().optional(),
  parentSimulationId: nonEmptyText.nullable().optional(),
  label: z.string().trim().min(1).max(200),
  depth: z.number().int().min(0),
  status: branchStatusSchema,
  createdAt: nonEmptyText,
  updatedAt: nonEmptyText,
} as const;

const optionBatchShape = {
  id: nonEmptyText,
  workspaceId: nonEmptyText,
  branchId: nonEmptyText,
  agentRunId: nonEmptyText,
  status: z.enum(OPTION_BATCH_STATUSES),
  priceManifestJson: nonEmptyText.nullable().optional(),
  priceManifestSha256: nonEmptyText.nullable().optional(),
  createdAt: nonEmptyText,
} as const;

const optionShape = {
  id: nonEmptyText,
  batchId: nonEmptyText,
  workspaceId: nonEmptyText,
  sequenceNo: z.number().int().min(0),
  label: nonEmptyText,
  descriptionText: nonEmptyText,
  tradesJson: nonEmptyText,
  executedBranchId: nonEmptyText.nullable().optional(),
  createdAt: nonEmptyText,
} as const;

const snapshotShape = {
  id: nonEmptyText,
  workspaceId: nonEmptyText,
  branchId: nonEmptyText,
  portfolioSnapshotId: nonEmptyText,
  baseSnapshotId: nonEmptyText.nullable().optional(),
  cashDecimal: nonNegativeDecimalText,
  totalMarketValueDecimal: nonNegativeDecimalText,
  metricsJson: nonEmptyText,
  modelVersion: nonEmptyText,
  createdAt: nonEmptyText,
} as const;

const snapshotItemShape = {
  id: nonEmptyText,
  snapshotId: nonEmptyText,
  instrumentId: nonEmptyText,
  quantityDecimal: nonNegativeDecimalText,
  priceDecimal: nonNegativeDecimalText,
  marketValueDecimal: nonNegativeDecimalText,
  weightBps: z.number().int().min(0).max(10_000),
  createdAt: nonEmptyText,
} as const;

const branchEventShape = {
  id: nonEmptyText,
  workspaceId: nonEmptyText,
  eventType: z.enum(BRANCH_EVENT_TYPES),
  fromBranchId: nonEmptyText.nullable().optional(),
  toBranchId: nonEmptyText,
  optionId: nonEmptyText.nullable().optional(),
  userId: nonEmptyText,
  createdAt: nonEmptyText,
} as const;

function branchRefine<T extends z.ZodObject<z.ZodRawShape>>(schema: T) {
  return schema.superRefine((value, ctx) => {
    const isRoot = value.depth === 0;
    const hasParentBranch = value.parentBranchId != null;
    const hasParentOption = value.parentOptionId != null;
    const hasParentSimulation = value.parentSimulationId != null;

    if (isRoot) {
      if (hasParentBranch) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["parentBranchId"], message: "Root branches must not set parentBranchId." });
      }

      if (hasParentOption) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["parentOptionId"], message: "Root branches must not set parentOptionId." });
      }

      if (hasParentSimulation) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["parentSimulationId"], message: "Root branches must not set parentSimulationId." });
      }
      return;
    }

    if (!hasParentBranch) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["parentBranchId"], message: "Non-root branches must set all parent references." });
    }

    if (!hasParentOption) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["parentOptionId"], message: "Non-root branches must set all parent references." });
    }

    if (!hasParentSimulation) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["parentSimulationId"], message: "Non-root branches must set all parent references." });
    }
  });
}

export const simulationWorkspaceSelectSchema = z.object(workspaceShape);
export const simulationWorkspaceInsertSchema = z.object({
  ...workspaceShape,
  status: z.enum(WORKSPACE_STATUSES).default("active"),
  rowVersion: z.number().int().min(1).default(1),
});

export const simulationBranchSelectSchema = branchRefine(z.object(branchShape));
export const simulationBranchInsertSchema = branchRefine(
  z.object({
    ...branchShape,
    status: branchStatusSchema.default("active"),
    depth: z.number().int().min(0).default(0),
  }),
);

export const simulationOptionBatchSelectSchema = z.object(optionBatchShape);
export const simulationOptionBatchInsertSchema = z.object({
  ...optionBatchShape,
  status: z.enum(OPTION_BATCH_STATUSES).default("queued"),
});

export const simulationOptionSelectSchema = z.object(optionShape);
export const simulationOptionInsertSchema = z.object(optionShape);
export const simulationOptionInsertListSchema = z.array(simulationOptionInsertSchema).superRefine((rows, ctx) => {
  const seen = new Map<string, number>();

  for (let index = 0; index < rows.length; index += 1) {
    const key = rows[index].executedBranchId;
    if (key == null) {
      continue;
    }

    const previous = seen.get(key);
    if (previous != null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "executedBranchId"], message: `executedBranchId must be unique; first seen at row ${previous}.` });
      continue;
    }

    seen.set(key, index);
  }
});

export const simulationAssetSnapshotSelectSchema = z.object(snapshotShape);
export const simulationAssetSnapshotInsertSchema = z.object(snapshotShape);

export const simulationAssetSnapshotItemSelectSchema = z.object(snapshotItemShape);
export const simulationAssetSnapshotItemInsertSchema = z.object(snapshotItemShape);

export const simulationBranchEventSelectSchema = z.object(branchEventShape);
export const simulationBranchEventInsertSchema = z.object(branchEventShape);

export type SimulationWorkspaceInsert = z.infer<typeof simulationWorkspaceInsertSchema>;
export type SimulationWorkspaceSelect = z.infer<typeof simulationWorkspaceSelectSchema>;
export type SimulationBranchInsert = z.infer<typeof simulationBranchInsertSchema>;
export type SimulationBranchSelect = z.infer<typeof simulationBranchSelectSchema>;
export type SimulationOptionBatchInsert = z.infer<typeof simulationOptionBatchInsertSchema>;
export type SimulationOptionBatchSelect = z.infer<typeof simulationOptionBatchSelectSchema>;
export type SimulationOptionInsert = z.infer<typeof simulationOptionInsertSchema>;
export type SimulationOptionSelect = z.infer<typeof simulationOptionSelectSchema>;
export type SimulationAssetSnapshotInsert = z.infer<typeof simulationAssetSnapshotInsertSchema>;
export type SimulationAssetSnapshotSelect = z.infer<typeof simulationAssetSnapshotSelectSchema>;
export type SimulationAssetSnapshotItemInsert = z.infer<typeof simulationAssetSnapshotItemInsertSchema>;
export type SimulationAssetSnapshotItemSelect = z.infer<typeof simulationAssetSnapshotItemSelectSchema>;
export type SimulationBranchEventInsert = z.infer<typeof simulationBranchEventInsertSchema>;
export type SimulationBranchEventSelect = z.infer<typeof simulationBranchEventSelectSchema>;
