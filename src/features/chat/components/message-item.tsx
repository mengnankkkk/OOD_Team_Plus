import type { UIMessage } from "ai";

import { DelegationStatus } from "@/features/chat/components/delegation-status";
import { getDelegationView } from "@/features/chat/lib/delegation-state";

export function MessageItem({ message, settled = false }: { message: UIMessage; settled?: boolean }) {
  const isUser = message.role === "user";
  const textParts = message.parts.filter((part) => part.type === "text");
  const delegationViews = Array.from(
    message.parts.reduce((views, part) => {
      const view = getDelegationView(part);
      if (view) {
        const previous = views.get(view.key);
        const rank = { running: 0, failed: 1, complete: 2 };
        const normalized = settled && view.status === "running"
          ? { ...view, status: "complete" as const }
          : view;
        if (!previous || rank[normalized.status] >= rank[previous.status]) {
          views.set(view.key, normalized);
        }
      }
      return views;
    }, new Map<string, NonNullable<ReturnType<typeof getDelegationView>>>()),
  ).map(([, view]) => view);

  return (
    <article className={isUser ? "message message-user" : "message message-agent"}>
      <div className="message-label">
        <span>{isUser ? "YOU" : "MW"}</span>
        {isUser ? "你的消息" : "Money Whisperer"}
      </div>
      {delegationViews.length > 0 && (
        <div className="delegation-list" aria-label="Agent 协作状态">
          {delegationViews.map((view, index) => (
            <DelegationStatus key={`${view.key}-${index}`} view={view} />
          ))}
        </div>
      )}
      {textParts.map((part, index) => (
        <p className="message-text" key={index}>
          {part.text}
        </p>
      ))}
    </article>
  );
}
