import { describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  createWorkspace: vi.fn().mockReturnValue({
    workspaceId: "workspace-1",
    branchId: "branch-1",
    analysisId: "analysis-1",
    version: 1,
    portfolioSnapshotId: "snapshot-1",
    portfolioSource: "USER_PORTFOLIO",
  }),
  generateOptions: vi.fn(),
  listOptions: vi.fn(),
  executeOption: vi.fn(),
  getWorkspace: vi.fn(),
  getBranchSnapshot: vi.fn(),
  switchBranch: vi.fn(),
  undoBranch: vi.fn(),
  archiveWorkspace: vi.fn(),
  cancelOptionGeneration: vi.fn(),
}));

vi.mock("@/server/extensions/simulation/service", () => services);
vi.mock("../context-service", () => ({
  requireA2AContext: vi.fn(() => ({
    id: "context-1",
    externalClientId: "client-1",
    executionUserId: "exec-1",
  })),
}));
vi.mock("../task-service", () => ({
  startA2ATask: vi.fn((_clientId, _taskId) => task("working")),
  completeA2ATask: vi.fn((_clientId, _taskId, result) => ({ ...task("completed"), result })),
  requireInputForA2ATask: vi.fn(),
  setA2ATaskDomainResource: vi.fn((_clientId, _taskId, type, id) => ({
    ...task("working"),
    domainResourceType: type,
    domainResourceId: id,
  })),
}));

import { cancelSimulationCapability, runSimulationCapability } from "./simulation";

describe("A2A simulation adapter", () => {
  it("starts from the context-owned server-priced snapshot", async () => {
    const result = await runSimulationCapability({
      principal: { clientId: "client-1", name: "Client", capabilities: ["scenario_simulation"], rateLimitPerMinute: 60 },
      task: task("submitted"),
      context: {
        id: "context-1", externalClientId: "client-1", executionUserId: "exec-1",
        primaryCapability: "scenario_simulation", status: "ACTIVE", profile: {}, goals: [],
        portfolioInput: null, portfolioSnapshotId: "snapshot-1", createdAt: "", updatedAt: "", expiresAt: "",
      },
      messageId: "message-1",
      text: "Compare hold and rebalance",
      operation: "start",
      input: { label: "External simulation", objective: "Compare hold and rebalance" },
      acceptedOutputModes: [],
    });

    expect(services.createWorkspace).toHaveBeenCalledWith("exec-1", expect.objectContaining({
      portfolioSnapshotId: "snapshot-1",
    }));
    expect(result.result?.artifacts[0].name).toBe("simulation_workspace");
  });

  it("keeps option generation working until the domain batch finishes", async () => {
    services.generateOptions.mockReturnValueOnce({
      batchId: "batch-1",
      analysisId: "analysis-2",
      status: "queued",
    });

    const result = await runSimulationCapability({
      principal: { clientId: "client-1", name: "Client", capabilities: ["scenario_simulation"], rateLimitPerMinute: 60 },
      task: { ...task("submitted"), operation: "generate_options" },
      context: {
        id: "context-1", externalClientId: "client-1", executionUserId: "exec-1",
        primaryCapability: "scenario_simulation", status: "ACTIVE", profile: {}, goals: [],
        portfolioInput: null, portfolioSnapshotId: "snapshot-1", createdAt: "", updatedAt: "", expiresAt: "",
      },
      messageId: "message-2",
      text: "Generate defensive branches",
      operation: "generate_options",
      input: { workspaceId: "workspace-1" },
      acceptedOutputModes: [],
    });

    expect(result).toMatchObject({
      status: "working",
      domainResourceType: "simulation_option_batch",
      domainResourceId: "batch-1",
    });
  });

  it("cancels an active option generation owned by the execution principal", () => {
    cancelSimulationCapability({
      principal: { clientId: "client-1", name: "Client", capabilities: ["tasks_cancel"], rateLimitPerMinute: 60 },
      task: {
        ...task("working"),
        domainResourceType: "simulation_option_batch",
        domainResourceId: "batch-1",
      },
    });

    expect(services.cancelOptionGeneration).toHaveBeenCalledWith("exec-1", "batch-1");
  });
});

function task(status: "submitted" | "working" | "completed") {
  return {
    id: "task-1", externalClientId: "client-1", contextId: "context-1",
    capabilityId: "scenario_simulation" as const, operation: "start", status,
    domainResourceType: null, domainResourceId: null, result: null, error: null,
    createdAt: "", startedAt: null, completedAt: null, events: [],
  };
}
