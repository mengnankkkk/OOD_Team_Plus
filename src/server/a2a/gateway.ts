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
  toA2ASendMessageResponse,
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
const DEFAULT_INITIAL_RESPONSE_TIMEOUT_MS = 750;
const MAX_INITIAL_RESPONSE_TIMEOUT_MS = 5_000;
const DEFAULT_STREAM_MAX_DURATION_MS = 60_000;
const STREAM_POLL_INTERVAL_MS = 250;

export function createA2ARequestHandlers(adapters: AdapterRegistry) {
  return {
    handleJsonRpcA2ARequest: (request: NextRequest) => handleJsonRpcA2ARequest(request, adapters),
    handleHttpSendMessage: (request: NextRequest) => handleHttpSendMessage(request, adapters),
    handleHttpStreamMessage: (request: NextRequest) => handleHttpStreamMessage(request, adapters),
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
  if (
    rpc
    && isRecord(body)
    && (body.method === "message/stream" || body.method === "SendStreamingMessage")
  ) {
    return handleJsonRpcA2AStreamRequest(request, body, adapters);
  }
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

async function handleJsonRpcA2AStreamRequest(
  request: NextRequest,
  body: Record<string, unknown>,
  adapters: AdapterRegistry,
): Promise<Response> {
  const requestId = jsonRpcRequestId(body);
  try {
    const principal = authenticateExternalRequest(request);
    const command = parseJsonRpcCommand({ ...body, method: "message/send" });
    const envelope = await executeA2ACommand(principal, command, adapters) as {
      result?: { task?: Record<string, unknown> };
    };
    const task = envelope.result?.task;
    if (!task || typeof task.id !== "string") {
      throw new A2APublicError("A2A_INTERNAL_ERROR", 500, "A2A stream did not create a task");
    }
    return streamA2ATask(principal.clientId, task.id, task, requestId);
  } catch (error) {
    const publicError = asPublicError(error);
    return a2aJson(jsonRpcError(requestId, publicError), publicError.status);
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

export async function handleHttpStreamMessage(
  request: NextRequest,
  adapters: AdapterRegistry,
): Promise<Response> {
  try {
    const principal = authenticateExternalRequest(request);
    const command = parseHttpSendMessage(await request.json().catch(() => null));
    const envelope = await executeA2ACommand(principal, command, adapters) as {
      result?: { task?: Record<string, unknown> };
    };
    const task = envelope.result?.task;
    if (!task || typeof task.id !== "string") {
      throw new A2APublicError("A2A_INTERNAL_ERROR", 500, "A2A stream did not create a task");
    }
    return streamA2ATask(principal.clientId, task.id, task);
  } catch (error) {
    return publicErrorResponse(error);
  }
}

function streamA2ATask(
  clientId: string,
  taskId: string,
  initialTask: Record<string, unknown>,
  jsonRpcRequestId?: string | number | null,
): Response {
  const encoder = new TextEncoder();
  let cancelStream: () => void = () => undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const timers: {
        pollTimer?: ReturnType<typeof setInterval>;
        maxDurationTimer?: ReturnType<typeof setTimeout>;
      } = {};
      let lastState = taskState(initialTask);
      let lastArtifactCount = taskArtifacts(initialTask).length;

      const close = () => {
        if (closed) return;
        closed = true;
        if (timers.pollTimer) clearInterval(timers.pollTimer);
        if (timers.maxDurationTimer) clearTimeout(timers.maxDurationTimer);
        controller.close();
      };
      cancelStream = close;

      const emit = (payload: Record<string, unknown>) => {
        if (closed) return;
        const body = jsonRpcRequestId === undefined
          ? payload
          : jsonRpcSuccess(jsonRpcRequestId, payload);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(body)}\n\n`));
      };

      emit({ task: initialTask });
      if (isTerminalTaskState(lastState)) {
        close();
        return;
      }

      const poll = () => {
        if (closed) return;
        try {
          const stored = getA2ATask(clientId, taskId);
          if (!stored) {
            close();
            return;
          }
          const current = toA2ATaskResource(refreshA2ATaskFromDomain(clientId, taskId));
          const currentState = taskState(current);
          const artifacts = taskArtifacts(current);
          for (const artifact of artifacts.slice(lastArtifactCount)) {
            emit({
              artifactUpdate: {
                taskId,
                contextId: current.contextId,
                artifact,
                append: false,
                lastChunk: true,
              },
            });
          }
          lastArtifactCount = artifacts.length;
          if (currentState !== lastState) {
            emit({
              statusUpdate: {
                taskId,
                contextId: current.contextId,
                status: current.status,
              },
            });
            lastState = currentState;
          }
          if (isTerminalTaskState(currentState)) close();
        } catch {
          close();
        }
      };

      timers.pollTimer = setInterval(poll, STREAM_POLL_INTERVAL_MS);
      timers.maxDurationTimer = setTimeout(close, streamMaxDurationMs());
    },
    cancel() {
      cancelStream();
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    },
  });
}

function taskState(task: Record<string, unknown>): string {
  return isRecord(task.status) && typeof task.status.state === "string"
    ? task.status.state
    : "";
}

function taskArtifacts(task: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(task.artifacts)
    ? task.artifacts.filter(isRecord)
    : [];
}

function isTerminalTaskState(state: string): boolean {
  return [
    "TASK_STATE_COMPLETED",
    "TASK_STATE_FAILED",
    "TASK_STATE_CANCELED",
    "TASK_STATE_REJECTED",
    "TASK_STATE_INPUT_REQUIRED",
    "TASK_STATE_AUTH_REQUIRED",
  ].includes(state);
}

function streamMaxDurationMs(): number {
  const configured = Number(process.env.A2A_STREAM_MAX_DURATION_MS);
  if (!Number.isFinite(configured)) return DEFAULT_STREAM_MAX_DURATION_MS;
  return Math.min(Math.max(Math.trunc(configured), 1_000), 300_000);
}

function jsonRpcRequestId(body: Record<string, unknown>): string | number | null {
  return typeof body.id === "string" || typeof body.id === "number" ? body.id : null;
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
      const execution = runCapabilityAdapter(principal, command, context, created.task, adapters);
      const initialResult = await waitForInitialResult(
        execution,
        initialResponseTimeoutMs(),
      );
      task = initialResult
        ?? getA2ATask(principal.clientId, created.task.id)
        ?? created.task;
    }
    return jsonRpcSuccess(command.requestId, toA2ASendMessageResponse(task));
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

async function runCapabilityAdapter(
  principal: ExternalClientPrincipal,
  command: Extract<A2ACommand, { kind: "send-message" }>,
  context: Awaited<ReturnType<typeof createContext>>,
  task: ReturnType<typeof createA2ATask>["task"],
  adapters: AdapterRegistry,
) {
  try {
    return await adapters[command.payload.capabilityId].run({
      principal,
      task,
      context,
      messageId: command.payload.messageId,
      text: command.payload.text,
      operation: command.payload.operation,
      input: command.payload.input,
      acceptedOutputModes: command.payload.acceptedOutputModes,
    });
  } catch (error) {
    const publicError = asPublicError(error);
    failA2ATask(principal.clientId, task.id, publicError);
    writeA2AAudit({
      clientId: principal.clientId,
      action: "A2A_CAPABILITY_INVOKE",
      targetType: "A2A_TASK",
      targetId: task.id,
      outcome: "FAILED",
      metadata: { code: publicError.code },
    });
    throw error;
  }
}

function waitForInitialResult<T>(
  execution: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    let waiting = true;
    const timeout = setTimeout(() => {
      waiting = false;
      resolve(null);
    }, timeoutMs);
    execution.then(
      (result) => {
        if (!waiting) return;
        waiting = false;
        clearTimeout(timeout);
        resolve(result);
      },
      (error: unknown) => {
        if (!waiting) return;
        waiting = false;
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function initialResponseTimeoutMs(): number {
  const configured = Number(process.env.A2A_INITIAL_RESPONSE_TIMEOUT_MS);
  if (!Number.isFinite(configured)) return DEFAULT_INITIAL_RESPONSE_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(configured), 0), MAX_INITIAL_RESPONSE_TIMEOUT_MS);
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
