import { handleChatStream } from "@mastra/ai-sdk";
import { createUIMessageStreamResponse, type UIMessage } from "ai";

import { mastra } from "@/mastra";
import type { z } from "zod";
import type { chatRequestSchema } from "@/server/chat/contract";
import { sanitizeStreamError } from "@/server/chat/errors";

type ChatRequest = z.infer<typeof chatRequestSchema>;

export async function streamChat(request: ChatRequest, signal: AbortSignal) {
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
    },
    sendReasoning: false,
    sendSources: false,
    onError: sanitizeStreamError,
  });

  return createUIMessageStreamResponse({ stream });
}
