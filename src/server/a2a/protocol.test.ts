import { describe, expect, it } from "vitest";

import {
  jsonRpcError,
  parseJsonRpcCommand,
  parseHttpSendMessage,
  toA2ATaskResource,
} from "./protocol";

describe("A2A protocol normalization", () => {
  it.each(["message/send", "SendMessage"])("normalizes %s", (method) => {
    expect(parseJsonRpcCommand({
      jsonrpc: "2.0",
      id: "rpc-1",
      method,
      params: capabilityMessage(),
    })).toMatchObject({
      kind: "send-message",
      requestId: "rpc-1",
      payload: {
        capabilityId: "debate_mode",
        operation: "start",
        input: { targetSymbol: "AAPL" },
      },
    });
  });

  it.each([
    ["tasks/get", "get-task"],
    ["GetTask", "get-task"],
    ["tasks/list", "list-tasks"],
    ["ListTasks", "list-tasks"],
    ["tasks/cancel", "cancel-task"],
    ["CancelTask", "cancel-task"],
  ])("normalizes %s", (method, kind) => {
    expect(parseJsonRpcCommand({
      jsonrpc: "2.0",
      id: "rpc-1",
      method,
      params: { id: "task-1" },
    })).toMatchObject({ kind });
  });

  it("defaults HTTP messages to the Chief Advisor", () => {
    expect(parseHttpSendMessage({
      message: {
        kind: "message",
        role: "user",
        messageId: "message-1",
        parts: [{ kind: "text", text: "Review my portfolio" }],
      },
    })).toMatchObject({
      kind: "send-message",
      payload: {
        capabilityId: "chief_advisor_conversation",
        operation: "send",
      },
    });
  });

  it("maps persisted tasks into A2A task resources", () => {
    expect(toA2ATaskResource({
      id: "task-1",
      externalClientId: "client-1",
      contextId: "context-1",
      capabilityId: "research_search",
      operation: "start",
      status: "completed",
      domainResourceType: "research_search",
      domainResourceId: "search-1",
      result: {
        message: "Done",
        artifacts: [{ artifactId: "artifact-1", name: "research_results", text: "Done", data: {} }],
      },
      error: null,
      createdAt: "2026-07-25T00:00:00.000Z",
      startedAt: "2026-07-25T00:00:01.000Z",
      completedAt: "2026-07-25T00:00:02.000Z",
      events: [],
    })).toMatchObject({
      id: "task-1",
      status: {
        state: "TASK_STATE_COMPLETED",
        message: {
          role: "ROLE_AGENT",
          parts: [{ text: "Done" }],
        },
      },
      artifacts: [{
        artifactId: "artifact-1",
        name: "research_results",
        parts: [{ text: "Done" }, { data: {} }],
      }],
    });
  });

  it("uses numeric JSON-RPC codes and preserves the application code in error data", () => {
    expect(jsonRpcError("rpc-1", {
      code: "CAPABILITY_NOT_ALLOWED",
      message: "Not allowed",
      status: 403,
    })).toEqual({
      jsonrpc: "2.0",
      id: "rpc-1",
      error: {
        code: -32000,
        message: "Not allowed",
        data: {
          code: "CAPABILITY_NOT_ALLOWED",
          status: 403,
          retryable: false,
          details: undefined,
        },
      },
    });
  });
});

function capabilityMessage() {
  return {
    message: {
      kind: "message",
      role: "user",
      messageId: "message-1",
      contextId: "context-1",
      parts: [{ kind: "text", text: "Start a debate" }],
      metadata: {
        capabilityId: "debate_mode",
        operation: "start",
        input: { targetSymbol: "AAPL" },
      },
    },
  };
}
