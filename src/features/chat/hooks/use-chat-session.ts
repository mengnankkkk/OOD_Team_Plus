"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useState } from "react";

import type { MemoryIdentity } from "@/server/chat/contract";

function readableError(error: Error | undefined) {
  if (!error) return null;

  try {
    const parsed = JSON.parse(error.message) as {
      error?: { message?: string };
    };
    return parsed.error?.message ?? "对话服务暂时不可用，请稍后重试。";
  } catch {
    return "对话服务暂时不可用，请稍后重试。";
  }
}

export function useChatSession(identity: MemoryIdentity) {
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            message: messages.at(-1),
            memory: identity,
          },
        }),
      }),
    [identity],
  );
  const chat = useChat({ id: identity.thread, transport });
  const { setMessages } = chat;

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams(identity).toString();

    async function loadHistory() {
      try {
        const response = await fetch(`/api/chat/history?${query}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("history");
        const data = (await response.json()) as { messages: UIMessage[] };
        setMessages(data.messages);
      } catch {
        if (!controller.signal.aborted) {
          setHistoryError("无法恢复本次会话，请刷新页面重试。");
        }
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false);
      }
    }

    void loadHistory();
    return () => controller.abort();
  }, [identity, setMessages]);

  return {
    ...chat,
    errorMessage: historyError ?? readableError(chat.error),
    historyLoading,
  };
}
