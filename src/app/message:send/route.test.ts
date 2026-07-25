import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const { runConversationAgentMock } = vi.hoisted(() => ({
  runConversationAgentMock: vi.fn(),
}));

vi.mock("@/server/extensions/advisor/service", () => ({
  runConversationAgent: runConversationAgentMock,
}));

import { POST } from "./route";

describe("A2A message:send", () => {
  it("rejects requests without bearer auth", async () => {
    vi.stubEnv("A2A_BEARER_TOKEN", "secret");
    const response = await POST(jsonRequest({ message: { parts: [{ kind: "text", text: "分析 AAPL" }] } }));
    expect(response.status).toBe(401);
    vi.unstubAllEnvs();
  });

  it("runs the advisor and returns an A2A task", async () => {
    vi.stubEnv("A2A_BEARER_TOKEN", "secret");
    runConversationAgentMock.mockResolvedValueOnce({
      messageId: "user-message-1",
      assistantMessageId: "assistant-message-1",
      analysis: { analysisId: "analysis-1", status: "COMPLETED", streamUrl: "/api/v1/analyses/analysis-1/events" },
      answer: "结论：暂不加仓。",
      recommendationId: "recommendation-1",
      missingQuestions: [],
      dataQueryId: null,
      outputMode: "SQL_ONLY",
    });

    const response = await POST(jsonRequest({
      message: {
        kind: "message",
        role: "user",
        messageId: "remote-message-1",
        contextId: "remote-context-1",
        parts: [{ kind: "text", text: "分析 AAPL 当前是否适合加仓" }],
      },
    }, "secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      kind: "task",
      id: "analysis-1",
      contextId: "remote-context-1",
      status: { state: "completed" },
      artifacts: [{ artifactId: "recommendation-1" }],
    });
    expect(body.status.message.parts[0].text).toContain("风险提示");
    expect(runConversationAgentMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: "a2a-remote-agent",
      sessionId: "remote-context-1",
      content: "分析 AAPL 当前是否适合加仓",
      clientMessageId: "remote-message-1",
    }));
    vi.unstubAllEnvs();
  });

  it("accepts JSON-RPC message/send envelopes", async () => {
    vi.stubEnv("A2A_BEARER_TOKEN", "secret");
    runConversationAgentMock.mockResolvedValueOnce({
      messageId: "user-message-2",
      assistantMessageId: "assistant-message-2",
      analysis: { analysisId: "analysis-2", status: "WAITING_FOR_USER" },
      answer: "在给出交易倾向前还缺少关键信息。",
      recommendationId: null,
      missingQuestions: ["你能接受的风险等级是稳健、平衡还是进取？"],
      dataQueryId: null,
      outputMode: "SQL_ONLY",
    });

    const response = await POST(jsonRequest({
      jsonrpc: "2.0",
      id: "rpc-1",
      method: "message/send",
      params: {
        message: {
          kind: "message",
          role: "user",
          messageId: "remote-message-2",
          parts: [{ kind: "text", text: "帮我评估当前组合风险" }],
        },
      },
    }, "secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: "rpc-1",
      result: {
        kind: "task",
        id: "analysis-2",
        status: { state: "input-required" },
      },
    });
    vi.unstubAllEnvs();
  });
});

function jsonRequest(body: unknown, bearer?: string): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (bearer) headers.set("authorization", `Bearer ${bearer}`);
  return new NextRequest("http://localhost/message:send", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
