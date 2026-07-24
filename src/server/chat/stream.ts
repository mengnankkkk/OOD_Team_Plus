import { handleChatStream } from "@mastra/ai-sdk";
import { createUIMessageStreamResponse, type UIMessage } from "ai";

import { mastra } from "@/mastra";
import type { z } from "zod";
import type { chatRequestSchema } from "@/server/chat/contract";
import { sanitizeStreamError } from "@/server/chat/errors";
import { RequestContext } from "@mastra/core/request-context";

type ChatRequest = z.infer<typeof chatRequestSchema>;

export async function streamChat(request: ChatRequest, signal: AbortSignal, context: { userId: string; sessionId: string | null }) {
  const requestContext = new RequestContext();
  requestContext.set("userId", context.userId);
  requestContext.set("sessionId", context.sessionId);
  requestContext.set("outputMode", request.outputMode ?? "SQL_ONLY");
  const stream = await handleChatStream<UIMessage>({
    mastra,
    agentId: "supervisorAgent",
    version: "v6",
    params: {
      messages: [request.message],
      memory: request.memory,
      maxSteps: 8,
      modelSettings: { maxOutputTokens: 300, temperature: 0.2 },
      abortSignal: signal,
      requestContext,
    },
    sendReasoning: false,
    sendSources: false,
    onError: sanitizeStreamError,
  });

  return createUIMessageStreamResponse({ stream });
}
