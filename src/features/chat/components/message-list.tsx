import type { UIMessage } from "ai";
import { useEffect, useRef } from "react";

import { MessageItem } from "@/features/chat/components/message-item";

type MessageListProps = {
  messages: UIMessage[];
  historyLoading: boolean;
  status: string;
};

export function MessageList({
  messages,
  historyLoading,
  status,
}: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  if (historyLoading) {
    return <div className="chat-empty">正在取回本次会话...</div>;
  }

  if (messages.length === 0) {
    return (
      <div className="chat-empty">
        <span className="empty-mark">01</span>
        <h2>先说一件你正在思考的事。</h2>
        <p>Supervisor 会直接回答，或邀请 Explorer 与 Reviewer 一起完成分析。</p>
      </div>
    );
  }

  return (
    <div className="message-list" aria-live="polite">
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} settled={status === "ready"} />
      ))}
      {status === "submitted" && (
        <div className="thinking-line">Supervisor 正在判断下一步...</div>
      )}
      <div ref={endRef} />
    </div>
  );
}
