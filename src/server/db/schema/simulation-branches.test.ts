import { describe, expect, it } from "vitest";

import {
  simulationAssetSnapshotInsertSchema,
  simulationBranchInsertSchema,
  simulationOptionInsertListSchema,
  simulationOptionInsertSchema,
  simulationWorkspaceInsertSchema,
} from "./simulation-branches";

const workspaceBase = {
  id: "sw_01",
  userId: "user_01",
  portfolioSnapshotId: "ps_01",
  label: "Demo workspace",
  objectiveText: "Test the scenario tree",
  rootBranchId: "sb_root",
  activeBranchId: "sb_root",
  createdAt: "2026-07-24T00:00:00Z",
  updatedAt: "2026-07-24T00:00:00Z",
};

describe("SimulationBranchInsert", () => {
  it("validates root branch has null parents", () => {
    const result = simulationBranchInsertSchema.safeParse({
      id: "sb_root",
      workspaceId: "sw_01",
      label: "Root",
      depth: 0,
      createdAt: "2026-07-24T00:00:00Z",
      updatedAt: "2026-07-24T00:00:00Z",
    });

    expect(result.success).toBe(true);
  });

  it("rejects non-root with missing parent FK", () => {
    const result = simulationBranchInsertSchema.safeParse({
      id: "sb_child",
      workspaceId: "sw_01",
      label: "Child",
      depth: 1,
      createdAt: "2026-07-24T00:00:00Z",
      updatedAt: "2026-07-24T00:00:00Z",
      parentBranchId: "sb_root",
      parentOptionId: "opt_01",
    });

    expect(result.success).toBe(false);
  });
});

describe("SimulationOptionInsert", () => {
  it("rejects duplicate executed_branch_id via uniqueness constraint", () => {
    const result = simulationOptionInsertListSchema.safeParse([
      {
        id: "opt_01",
        batchId: "batch_01",
        workspaceId: "sw_01",
        sequenceNo: 0,
        label: "A",
        descriptionText: "First",
        tradesJson: "[]",
        executedBranchId: "sb_exec",
        createdAt: "2026-07-24T00:00:00Z",
      },
      {
        id: "opt_02",
        batchId: "batch_01",
        workspaceId: "sw_01",
        sequenceNo: 1,
        label: "B",
        descriptionText: "Second",
        tradesJson: "[]",
        executedBranchId: "sb_exec",
        createdAt: "2026-07-24T00:01:00Z",
      },
    ]);

    expect(result.success).toBe(false);
  });

  it("accepts a valid option row", () => {
    const result = simulationOptionInsertSchema.safeParse({
      id: "opt_01",
      batchId: "batch_01",
      workspaceId: "sw_01",
      sequenceNo: 0,
      label: "A",
      descriptionText: "First",
      tradesJson: "[]",
      createdAt: "2026-07-24T00:00:00Z",
    });

    expect(result.success).toBe(true);
  });
});

describe("SimulationWorkspaceInsert", () => {
  it("accepts default active status when omitted", () => {
    const result = simulationWorkspaceInsertSchema.safeParse(workspaceBase);

    expect(result.success).toBe(true);
  });
});

describe("SimulationAssetSnapshotInsert", () => {
  it("rejects invalid decimal strings", () => {
    const result = simulationAssetSnapshotInsertSchema.safeParse({
      id: "snap_01",
      workspaceId: "sw_01",
      branchId: "sb_root",
      portfolioSnapshotId: "ps_01",
      cashDecimal: "abc",
      totalMarketValueDecimal: "100.00",
      metricsJson: "{}",
      modelVersion: "v1",
      createdAt: "2026-07-24T00:00:00Z",
    });

    expect(result.success).toBe(false);
  });
});
