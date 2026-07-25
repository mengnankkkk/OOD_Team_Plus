import {
  archiveWorkspace,
  cancelOptionGeneration,
  createWorkspace,
  executeOption,
  generateOptions,
  getBranchSnapshot,
  getWorkspace,
  listOptions,
  switchBranch,
  undoBranch,
} from "@/server/extensions/simulation/service";
import { getDatabase } from "@/server/http/context";
import { requireA2AContext } from "../context-service";

import {
  A2APublicError,
  type A2ATaskView,
  type CapabilityAdapterInput,
  type CapabilityCancellationInput,
} from "../contracts";
import {
  completeA2ATask,
  requireInputForA2ATask,
  setA2ATaskDomainResource,
  startA2ATask,
} from "../task-service";

export async function runSimulationCapability(input: CapabilityAdapterInput): Promise<A2ATaskView> {
  startA2ATask(input.principal.clientId, input.task.id);
  if (input.operation === "start" && !input.context.portfolioSnapshotId) {
    return requireInputForA2ATask(input.principal.clientId, input.task.id, {
      message: "A caller-supplied portfolio is required to start a simulation.",
      artifacts: [],
    });
  }
  const workspaceId = input.operation === "start" ? null : resolveWorkspaceId(input);
  const result = invokeSimulation(input, workspaceId);
  if (input.operation === "generate_options") {
    const batchId = String((result as { batchId: string }).batchId);
    return setA2ATaskDomainResource(
      input.principal.clientId,
      input.task.id,
      "simulation_option_batch",
      batchId,
    );
  }
  const ownedWorkspaceId = input.operation === "start"
    ? String((result as { workspaceId: string }).workspaceId)
    : workspaceId!;
  setA2ATaskDomainResource(
    input.principal.clientId,
    input.task.id,
    "simulation_workspace",
    ownedWorkspaceId,
  );
  const artifactName = artifactFor(input.operation);
  return completeA2ATask(input.principal.clientId, input.task.id, {
    message: `Simulation operation '${input.operation}' completed.`,
    artifacts: [{
      artifactId: resourceId(result, ownedWorkspaceId),
      name: artifactName,
      text: JSON.stringify(result),
      data: asRecord(result),
    }],
  });
}

export function cancelSimulationCapability(input: CapabilityCancellationInput): void {
  if (
    input.task.domainResourceType !== "simulation_option_batch"
    || !input.task.domainResourceId
  ) return;
  const context = requireA2AContext(input.principal.clientId, input.task.contextId);
  cancelOptionGeneration(context.executionUserId, input.task.domainResourceId);
}

function invokeSimulation(input: CapabilityAdapterInput, workspaceId: string | null): unknown {
  const userId = input.context.executionUserId;
  switch (input.operation) {
    case "start":
      return createWorkspace(userId, {
        label: optionalString(input.input.label) ?? "External A2A simulation",
        objectiveText: optionalString(input.input.objective) ?? input.text,
        portfolioSnapshotId: input.context.portfolioSnapshotId!,
      });
    case "generate_options":
      return generateOptions(userId, workspaceId!, optionalString(input.input.objective) ?? input.text);
    case "get_options":
      return requireResult(listOptions(userId, workspaceId!, optionalString(input.input.batchId)));
    case "execute_option":
      return executeOption(userId, workspaceId!, {
        parentBranchId: requiredString(input.input.parentBranchId, "parentBranchId"),
        optionId: requiredString(input.input.optionId, "optionId"),
        name: optionalString(input.input.name) ?? "External branch",
      });
    case "get_tree":
      return requireResult(getWorkspace(userId, workspaceId!));
    case "get_snapshot":
      return requireResult(getBranchSnapshot(
        userId,
        workspaceId!,
        requiredString(input.input.branchId, "branchId"),
      ));
    case "switch_branch":
      return requireResult(switchBranch(
        userId,
        workspaceId!,
        requiredString(input.input.branchId, "branchId"),
        optionalNumber(input.input.version),
      ));
    case "undo":
      return requireResult(undoBranch(userId, workspaceId!, optionalNumber(input.input.version)));
    case "archive":
      return archiveWorkspace(
        userId,
        workspaceId!,
        requiredNumber(input.input.version, "version"),
      );
    default:
      throw new A2APublicError("INVALID_OPERATION", 422, "Unsupported simulation operation");
  }
}

function resolveWorkspaceId(input: CapabilityAdapterInput): string {
  const explicit = optionalString(input.input.workspaceId);
  if (explicit) return explicit;
  const db = getDatabase();
  const row = db.prepare(`SELECT id FROM simulation_workspaces
    WHERE user_id=? ORDER BY updated_at DESC LIMIT 1`).get(
    input.context.executionUserId,
  ) as { id?: string } | undefined;
  db.close();
  if (!row?.id) throw new A2APublicError("TASK_NOT_FOUND", 404, "Simulation workspace not found");
  return row.id;
}

function artifactFor(operation: string): string {
  if (operation === "get_options" || operation === "generate_options") return "simulation_options";
  if (operation === "get_snapshot") return "simulation_snapshot";
  if (operation === "execute_option" || operation === "switch_branch" || operation === "undo") return "simulation_branch";
  return "simulation_workspace";
}

function resourceId(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  return String(record.workspaceId ?? record.branchId ?? record.snapshotId ?? record.batchId ?? fallback);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : { value };
}

function requireResult<T>(value: T | null): T {
  if (value == null) throw new A2APublicError("TASK_NOT_FOUND", 404, "Simulation resource not found");
  return value;
}

function requiredString(value: unknown, name: string): string {
  const result = optionalString(value);
  if (!result) throw new A2APublicError("INVALID_REQUEST", 422, `${name} is required`);
  return result;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function requiredNumber(value: unknown, name: string): number {
  const result = optionalNumber(value);
  if (result === undefined) throw new A2APublicError("INVALID_REQUEST", 422, `${name} is required`);
  return result;
}
