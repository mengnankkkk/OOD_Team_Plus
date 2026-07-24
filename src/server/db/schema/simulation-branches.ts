import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { BRANCH_EVENT_TYPES, OPTION_BATCH_STATUSES, WORKSPACE_STATUSES } from "./enums";

export {
  simulationAssetSnapshotInsertSchema,
  simulationAssetSnapshotItemInsertSchema,
  simulationAssetSnapshotItemSelectSchema,
  simulationAssetSnapshotSelectSchema,
  simulationBranchEventInsertSchema,
  simulationBranchEventSelectSchema,
  simulationBranchInsertSchema,
  simulationBranchSelectSchema,
  simulationOptionBatchInsertSchema,
  simulationOptionBatchSelectSchema,
  simulationOptionInsertListSchema,
  simulationOptionInsertSchema,
  simulationOptionSelectSchema,
  simulationWorkspaceInsertSchema,
  simulationWorkspaceSelectSchema,
  type SimulationAssetSnapshotInsert,
  type SimulationAssetSnapshotItemInsert,
  type SimulationAssetSnapshotItemSelect,
  type SimulationAssetSnapshotSelect,
  type SimulationBranchEventInsert,
  type SimulationBranchEventSelect,
  type SimulationBranchInsert,
  type SimulationBranchSelect,
  type SimulationOptionBatchInsert,
  type SimulationOptionBatchSelect,
  type SimulationOptionInsert,
  type SimulationOptionSelect,
  type SimulationWorkspaceInsert,
  type SimulationWorkspaceSelect,
} from "./simulation-branches.zod";

export const simulationWorkspaces = sqliteTable(
  "simulation_workspaces",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    portfolioSnapshotId: text("portfolio_snapshot_id").notNull(),
    conversationSessionId: text("conversation_session_id"),
    recommendationId: text("recommendation_id"),
    status: text("status", { enum: WORKSPACE_STATUSES }).notNull().default("active"),
    label: text("label").notNull(),
    objectiveText: text("objective_text").notNull(),
    rootBranchId: text("root_branch_id").notNull(),
    activeBranchId: text("active_branch_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (t) => [
    index("idx_sw_user_status_updated").on(t.userId, t.status, t.updatedAt, t.id),
    index("idx_sw_session").on(t.conversationSessionId),
    index("idx_sw_recommendation").on(t.recommendationId),
  ],
);

export const simulationBranches = sqliteTable(
  "simulation_branches",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    parentBranchId: text("parent_branch_id"),
    parentOptionId: text("parent_option_id"),
    parentSimulationId: text("parent_simulation_id"),
    label: text("label").notNull(),
    depth: integer("depth").notNull().default(0),
    status: text("status", { enum: ["active", "archived", "discarded"] as const }).notNull().default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_sb_workspace_id_id").on(t.workspaceId, t.id),
    index("idx_sb_workspace_parent_created").on(t.workspaceId, t.parentBranchId, t.createdAt, t.id),
    index("idx_sb_parent_option").on(t.parentOptionId),
    index("idx_sb_parent_simulation").on(t.parentSimulationId),
  ],
);

export const simulationOptionBatches = sqliteTable(
  "simulation_option_batches",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    branchId: text("branch_id").notNull(),
    agentRunId: text("agent_run_id").notNull().unique(),
    status: text("status", { enum: OPTION_BATCH_STATUSES }).notNull().default("queued"),
    priceManifestJson: text("price_manifest_json"),
    priceManifestSha256: text("price_manifest_sha256"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_sob_workspace_branch_created").on(t.workspaceId, t.branchId, t.createdAt),
    index("idx_sob_status").on(t.status),
  ],
);

export const simulationOptions = sqliteTable(
  "simulation_options",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    sequenceNo: integer("sequence_no").notNull(),
    label: text("label").notNull(),
    descriptionText: text("description_text").notNull(),
    tradesJson: text("trades_json").notNull(),
    analysisJson: text("analysis_json").notNull().default("{}"),
    executedBranchId: text("executed_branch_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_so_batch_sequence").on(t.batchId, t.sequenceNo),
    uniqueIndex("uq_so_executed_branch").on(t.executedBranchId),
    index("idx_so_batch_created").on(t.batchId, t.createdAt),
  ],
);

export const simulationAssetSnapshots = sqliteTable(
  "simulation_asset_snapshots",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    branchId: text("branch_id").notNull().unique(),
    portfolioSnapshotId: text("portfolio_snapshot_id").notNull(),
    baseSnapshotId: text("base_snapshot_id"),
    cashDecimal: text("cash_decimal").notNull(),
    totalMarketValueDecimal: text("total_market_value_decimal").notNull(),
    metricsJson: text("metrics_json").notNull(),
    modelVersion: text("model_version").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_sas_workspace_created").on(t.workspaceId, t.createdAt)],
);

export const simulationAssetSnapshotItems = sqliteTable(
  "simulation_asset_snapshot_items",
  {
    id: text("id").primaryKey(),
    snapshotId: text("snapshot_id").notNull(),
    instrumentId: text("instrument_id").notNull(),
    quantityDecimal: text("quantity_decimal").notNull(),
    priceDecimal: text("price_decimal").notNull(),
    marketValueDecimal: text("market_value_decimal").notNull(),
    weightBps: integer("weight_bps").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_sasi_snapshot_instrument").on(t.snapshotId, t.instrumentId),
    index("idx_sasi_instrument").on(t.instrumentId),
  ],
);

export const simulationBranchEvents = sqliteTable(
  "simulation_branch_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    eventType: text("event_type", { enum: BRANCH_EVENT_TYPES }).notNull(),
    fromBranchId: text("from_branch_id"),
    toBranchId: text("to_branch_id").notNull(),
    optionId: text("option_id"),
    userId: text("user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_sbe_workspace_created").on(t.workspaceId, t.createdAt, t.id),
    index("idx_sbe_to_branch").on(t.toBranchId),
    index("idx_sbe_from_branch").on(t.fromBranchId),
  ],
);
