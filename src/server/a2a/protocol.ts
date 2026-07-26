import { createId, isoNow } from "@/server/http/context";

import {
  A2APublicError,
  CapabilityIdSchema,
  type A2ACommand,
  type A2ATaskView,
  type PublicA2AError,
} from "./contracts";

type MessageBody = {
  message?: {
    messageId?: unknown;
    contextId?: unknown;
    parts?: Array<{ kind?: unknown; type?: unknown; text?: unknown }>;
    metadata?: Record<string, unknown>;
  };
  configuration?: { acceptedOutputModes?: unknown };
};

export function parseJsonRpcCommand(body: unknown): A2ACommand {
  if (!isRecord(body) || body.jsonrpc !== "2.0") return parseLegacySendMessage(body);
  const requestId = validRequestId(body.id);
  const method = typeof body.method === "string" ? body.method : "";
  if (method === "message/send" || method === "SendMessage") {
    return parseSend(body.params, requestId);
  }
  if (method === "tasks/get" || method === "GetTask") {
    return { kind: "get-task", requestId, taskId: requiredId(body.params, "id") };
  }
  if (method === "tasks/list" || method === "ListTasks") {
    const params = isRecord(body.params) ? body.params : {};
    return {
      kind: "list-tasks",
      requestId,
      cursor: optionalId(params.cursor),
      limit: boundedLimit(params.limit),
    };
  }
  if (method === "tasks/cancel" || method === "CancelTask") {
    return { kind: "cancel-task", requestId, taskId: requiredId(body.params, "id") };
  }
  throw new A2APublicError("METHOD_NOT_FOUND", 400, "Unsupported A2A JSON-RPC method");
}

export function parseLegacySendMessage(body: unknown): A2ACommand {
  return parseSend(body, null);
}

export function parseHttpSendMessage(body: unknown): A2ACommand {
  return parseSend(body, null);
}

export function jsonRpcSuccess(requestId: string | number | null, result: unknown): unknown {
  return { jsonrpc: "2.0", id: requestId, result };
}

export function jsonRpcError(requestId: string | number | null, error: PublicA2AError): unknown {
  return {
    jsonrpc: "2.0",
    id: requestId,
    error: {
      code: jsonRpcErrorCode(error.code),
      message: error.message,
      data: {
        code: error.code,
        status: error.status,
        retryable: error.retryable ?? false,
        details: error.details,
      },
    },
  };
}

function jsonRpcErrorCode(code: string): number {
  if (code === "INVALID_REQUEST") return -32600;
  if (code === "METHOD_NOT_FOUND") return -32601;
  if (code === "INVALID_PARAMS") return -32602;
  if (code === "A2A_INTERNAL_ERROR") return -32603;
  return -32000;
}

export function toA2ATaskResource(task: A2ATaskView): Record<string, unknown> {
  const messageId = createId("a2a_agent_message");
  return {
    kind: "task",
    id: task.id,
    contextId: task.contextId,
    status: {
      state: task.status,
      timestamp: task.completedAt ?? task.startedAt ?? task.createdAt ?? isoNow(),
      message: task.result ? {
        kind: "message",
        role: "agent",
        messageId,
        taskId: task.id,
        contextId: task.contextId,
        parts: [{ kind: "text", text: task.result.message }],
      } : undefined,
    },
    artifacts: (task.result?.artifacts ?? []).map((artifact) => ({
      artifactId: artifact.artifactId,
      name: artifact.name,
      parts: [
        { kind: "text", text: artifact.text },
        { kind: "data", data: artifact.data },
      ],
    })),
    metadata: {
      capabilityId: task.capabilityId,
      operation: task.operation,
      domainResourceType: task.domainResourceType,
      domainResourceId: task.domainResourceId,
      error: task.error,
      events: task.events,
    },
  };
}

export function toA2ASendMessageResponse(task: A2ATaskView): { task: Record<string, unknown> } {
  return { task: toA2ATaskResource(task) };
}

function parseSend(body: unknown, requestId: string | number | null): A2ACommand {
  if (!isRecord(body)) throw new A2APublicError("INVALID_REQUEST", 400, "A2A request body is required");
  const value = body as MessageBody;
  const message = isRecord(value.message) ? value.message : undefined;
  const text = (message?.parts ?? [])
    .filter((part) => part?.kind === "text" || part?.type === "text" || typeof part?.text === "string")
    .map((part) => typeof part.text === "string" ? part.text.trim() : "")
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (!text) throw new A2APublicError("INVALID_REQUEST", 400, "Message must contain a text part");
  const metadata = isRecord(message?.metadata) ? message.metadata : {};
  const capability = CapabilityIdSchema.safeParse(
    metadata.capabilityId ?? "chief_advisor_conversation",
  );
  if (!capability.success) throw new A2APublicError("INVALID_REQUEST", 400, "Unknown capabilityId");
  return {
    kind: "send-message",
    requestId,
    payload: {
      messageId: optionalId(message?.messageId) ?? createId("a2a_message"),
      contextId: optionalId(message?.contextId) ?? null,
      text,
      capabilityId: capability.data,
      operation: optionalId(metadata.operation) ?? defaultOperation(capability.data),
      input: isRecord(metadata.input) ? metadata.input : {},
      acceptedOutputModes: Array.isArray(value.configuration?.acceptedOutputModes)
        ? value.configuration.acceptedOutputModes.filter((mode): mode is string => typeof mode === "string")
        : [],
    },
  };
}

function defaultOperation(capabilityId: string): string {
  return capabilityId === "chief_advisor_conversation" ? "send" : "start";
}

function requiredId(value: unknown, key: string): string {
  if (!isRecord(value)) throw new A2APublicError("INVALID_REQUEST", 400, `${key} is required`);
  const id = optionalId(value[key]);
  if (!id) throw new A2APublicError("INVALID_REQUEST", 400, `${key} is required`);
  return id;
}

function optionalId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() && value.length <= 160 ? value.trim() : undefined;
}

function validRequestId(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function boundedLimit(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 20);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 100) : 20;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
