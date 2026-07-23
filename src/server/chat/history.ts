import type { MastraDBMessage } from "@mastra/core/agent";
import type { UIMessage } from "ai";

import { memory } from "@/mastra";
import type { MemoryIdentity } from "@/server/chat/contract";

function toUiMessage(message: MastraDBMessage): UIMessage | null {
  if (message.role !== "user" && message.role !== "assistant") {
    return null;
  }

  const parts = message.content.parts.flatMap((part) => {
    if (part.type !== "text" || typeof part.text !== "string") {
      return [];
    }

    return [{ type: "text" as const, text: part.text }];
  });

  if (parts.length === 0) {
    return null;
  }

  return { id: message.id, role: message.role, parts };
}

export async function getDisplayHistory(identity: MemoryIdentity) {
  const thread = await memory.getThreadById({
    threadId: identity.thread,
    resourceId: identity.resource,
  });

  if (!thread) return [];

  const result = await memory.recall({
    threadId: identity.thread,
    resourceId: identity.resource,
    perPage: false,
    orderBy: { field: "createdAt", direction: "ASC" },
  });

  return result.messages.flatMap((message) => {
    const uiMessage = toUiMessage(message);
    return uiMessage ? [uiMessage] : [];
  });
}
