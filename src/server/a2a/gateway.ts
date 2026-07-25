/* eslint-disable max-lines */

import type { NextRequest } from "next/server";

import { authenticateExternalRequest, requireA2ACapability } from "./auth";
import { writeA2AAudit } from "./audit";
import {
  A2APublicError,
  ExternalGoalSchema,
  ExternalPortfolioSchema,
  ExternalProfileSchema,
  type A2ACommand,
  type CapabilityAdapter,
  type CapabilityId,
  type ExternalClientPrincipal,
  type PublicA2AError,
} from "./contracts";
import {
  createA2AContext,
  getA2AContext,
  getA2AContextOwner,
  requireCompatibleA2AContext,
} from "./context-service";
import {
  jsonRpcError,
  jsonRpcSuccess,
  parseHttpSendMessage,
  parseJsonRpcCommand,
  parseLegacySendMessage,
  toA2ATaskResource,
} from "./protocol";
import {
  cancelA2ATask,
  createA2ATask,
  failA2ATask,
  getA2ATask,
  listA2ATasks,
} from "./task-service";
import { refreshA2ATaskFromDomain } from "./task-refresh";

type AdapterRegistry = Record<CapabilityId, CapabilityAdapter>;

export function createA2ARequestHandlers(adapters: AdapterRegistry) {
  return {
    handleJsonRpcA2ARequest: (request: NextRequest) => handleJsonRpcA2ARequest(request, adapters),
    handleHttpSendMessage: (request: NextRequest) => handleHttpSendMessage(request, adapters),
    handleHttpListTasks: (request: NextRequest) => handleHttpListTasks(request, adapters),
    handleHttpTaskRequest: (request: NextRequest, path: string[]) =>
      handleHttpTaskRequest(request, path, adapters),
  };
}

export async function handleJsonRpcA2ARequest(
  request: NextRequest,
  adapters: AdapterRegistry,
): Promise<Response> {
  const body = await request.json().catch(() => null);
  const rpc = isRecord(body) && body.jsonrpc === "2.0";
  let requestId: string | number | null = null;
  try {
    const principal = authenticateExternalRequest(request);
    const command = rpc ? parseJsonRpcCommand(body) : parseLegacySendMessage(body);
    requestId = command.requestId;
    const result = await executeA2ACommand(principal, command, adapters);
    return a2aJson(rpc ? result : (result as { result: unknown }).result);
  } catch (error) {
    const publicError = asPublicError(error);
    return a2aJson(
      rpc ? jsonRpcError(requestId, publicError) : { error: publicError },
      publicError.status,
    );
  }
}

export async function handleHttpSendMessage(
  request: NextRequest,
  adapters: AdapterRegistry,
): Promise<Response> {
  try {
    const principal = authenticateExternalRequest(request);
    const command = parseHttpSendMessage(await request.json().catch(() => null));
    const envelope = await executeA2ACommand(principal, command, adapters) as { result: unknown };
    return a2aJson(envelope.result);
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function handleHttpListTasks(
  request: NextRequest,
  adapters: AdapterRegistry,
): Promise<Response> {
  try {
    const principal = authenticateExternalRequest(request);
    const command: A2ACommand = {
      kind: "list-tasks",
      requestId: null,
      cursor: request.nextUrl.searchParams.get("cursor") ?? undefined,
      limit: Number(request.nextUrl.searchParams.get("limit") ?? 20),
    };
    const envelope = await executeA2ACommand(principal, command, adapters) as { result: unknown };
    return a2aJson(envelope.result);
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function handleHttpTaskRequest(
  request: NextRequest,
  path: string[],
  adapters: AdapterRegistry,
): Promise<Response> {
  const raw = path.join("/");
  const cancel = raw.endsWith(":cancel");
  const taskId = cancel ? raw.slice(0, -":cancel".length) : raw;
  if (!taskId || taskId.includes("/")) {
    return a2aJson({ error: { code: "RESOURCE_NOT_FOUND", message: "Route not found" } }, 404);
  }
  try {
    const principal = authenticateExternalRequest(request);
    const command: A2ACommand = cancel
      ? { kind: "cancel-task", requestId: null, taskId }
      : { kind: "get-task", requestId: null, taskId };
    const envelope = await executeA2ACommand(principal, command, adapters) as { result: unknown };
    return a2aJson(envelope.result);
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function executeA2ACommand(
  principal: ExternalClientPrincipal,
  command: A2ACommand,
  adapters: AdapterRegistry,
): Promise<unknown> {
  if (command.kind === "send-message") {
    requireA2ACapability(principal, command.payload.capabilityId);
    const ownedContext = command.payload.contextId
      ? getA2AContext(principal.clientId, command.payload.contextId)
      : null;
    if (
      command.payload.contextId
      && !ownedContext
      && getA2AContextOwner(command.payload.contextId)
    ) {
      throw new A2APublicError("CONTEXT_NOT_FOUND", 404, "Context not found");
    }
    const context = ownedContext
      ? requireCompatibleA2AContext(
          principal.clientId,
          ownedContext.id,
          command.payload.capabilityId,
        )
      : await createContext(principal, command);
    const created = createA2ATask({
      externalClientId: principal.clientId,
      contextId: context.id,
      capabilityId: command.payload.capabilityId,
      operation: command.payload.operation,
      clientMessageId: command.payload.messageId,
      input: { text: command.payload.text, ...command.payload.input },
    });
    writeA2AAudit({
      clientId: principal.clientId,
      action: "A2A_CAPABILITY_INVOKE",
      targetType: "A2A_TASK",
      targetId: created.task.id,
      outcome: created.replayed ? "REPLAYED" : "ACCEPTED",
      metadata: {
        capabilityId: command.payload.capabilityId,
        operation: command.payload.operation,
      },
    });
    let task = created.task;
    if (!created.replayed) {
      try {
        task = await adapters[command.payload.capabilityId].run({
          principal,
          task: created.task,
          context,
          messageId: command.payload.messageId,
          text: command.payload.text,
          operation: command.payload.operation,
          input: command.payload.input,
          acceptedOutputModes: command.payload.acceptedOutputModes,
        });
      } catch (error) {
        const publicError = asPublicError(error);
        failA2ATask(principal.clientId, created.task.id, publicError);
        writeA2AAudit({
          clientId: principal.clientId,
          action: "A2A_CAPABILITY_INVOKE",
          targetType: "A2A_TASK",
          targetId: created.task.id,
          outcome: "FAILED",
          metadata: { code: publicError.code },
        });
        throw error;
      }
    }
    return jsonRpcSuccess(command.requestId, toA2ATaskResource(task));
  }
  if (command.kind === "get-task") {
    requireA2ACapability(principal, "tasks_read");
    const task = getA2ATask(principal.clientId, command.taskId);
    if (!task) throw new A2APublicError("TASK_NOT_FOUND", 404, "Task not found");
    return jsonRpcSuccess(
      command.requestId,
      toA2ATaskResource(refreshA2ATaskFromDomain(principal.clientId, task.id)),
    );
  }
  if (command.kind === "list-tasks") {
    requireA2ACapability(principal, "tasks_read");
    const listed = listA2ATasks(principal.clientId, command);
    return jsonRpcSuccess(command.requestId, {
      items: listed.items.map((task) =>
        toA2ATaskResource(refreshA2ATaskFromDomain(principal.clientId, task.id))),
      nextCursor: listed.nextCursor,
    });
  }
  requireA2ACapability(principal, "tasks_cancel");
  const storedTask = getA2ATask(principal.clientId, command.taskId);
  const task = storedTask
    ? refreshA2ATaskFromDomain(principal.clientId, storedTask.id)
    : null;
  if (!task) throw new A2APublicError("TASK_NOT_FOUND", 404, "Task not found");
  await adapters[task.capabilityId].cancel?.({ principal, task });
  const canceled = cancelA2ATask(principal.clientId, task.id);
  writeA2AAudit({
    clientId: principal.clientId,
    action: "A2A_TASK_CANCEL",
    targetType: "A2A_TASK",
    targetId: task.id,
    outcome: "SUCCEEDED",
    metadata: { capabilityId: task.capabilityId },
  });
  return jsonRpcSuccess(
    command.requestId,
    toA2ATaskResource(canceled),
  );
}

async function createContext(
  principal: ExternalClientPrincipal,
  command: Extract<A2ACommand, { kind: "send-message" }>,
) {
  const input = command.payload.input;
  const created = await createA2AContext({
    externalClientId: principal.clientId,
    capabilityId: command.payload.capabilityId,
    requestedContextId: command.payload.contextId ?? undefined,
    profile: ExternalProfileSchema.parse(input.profile ?? {}),
    goals: ExternalGoalSchema.array().parse(input.goals ?? []),
    portfolio: input.portfolio == null
      ? undefined
      : ExternalPortfolioSchema.parse(input.portfolio),
  });
  return requireCompatibleA2AContext(
    principal.clientId,
    created.contextId,
    command.payload.capabilityId,
  );
}

export function asPublicError(error: unknown): PublicA2AError {
  if (error instanceof A2APublicError) {
    return { code: error.code, message: error.message, status: error.status };
  }
  return {
    code: "A2A_INTERNAL_ERROR",
    message: "The A2A operation failed",
    status: 500,
    retryable: true,
  };
}

function publicErrorResponse(error: unknown): Response {
  const publicError = asPublicError(error);
  return a2aJson({ error: publicError }, publicError.status);
}

function a2aJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "content-type": "application/a2a+json; charset=utf-8" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
