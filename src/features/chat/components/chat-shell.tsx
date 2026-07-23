"use client";

import { CircleDot, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { ChatComposer } from "@/features/chat/components/chat-composer";
import { MessageList } from "@/features/chat/components/message-list";
import { useChatSession } from "@/features/chat/hooks/use-chat-session";
import { getSessionIdentity } from "@/features/chat/lib/session-identity";
import type { MemoryIdentity } from "@/server/chat/contract";

function ChatWorkspace({ identity }: { identity: MemoryIdentity }) {
  const chat = useChatSession(identity);
  const streaming = chat.status === "streaming" || chat.status === "submitted";

  return (
    <main className="app-shell">
      <header className="masthead">
        <a className="brand" href="#top" aria-label="Money Whisperer 首页">
          <span className="brand-mark">MW</span>
          <span>
            <strong>Money Whisperer</strong>
            <small>Supervisor Playground</small>
          </span>
        </a>
        <div className="runtime-badge">
          <CircleDot className="size-3.5" aria-hidden="true" />
          DeepSeek · Memory online
        </div>
      </header>

      <section className="workspace" id="top">
        <aside className="workspace-note">
          <span>THE FIRST LOOP</span>
          <h1>把复杂问题，交给一场安静的协作。</h1>
          <p>
            这是纯净的 Agent 技术底座。没有理财建议，没有业务规则，只有一次真实的
            Supervisor 对话闭环。
          </p>
          <div className="agent-legend">
            <div><b>E</b><span>Explorer<br /><small>分析与拆解</small></span></div>
            <div><b>R</b><span>Reviewer<br /><small>复核与补充</small></span></div>
          </div>
        </aside>

        <div className="chat-panel">
          <div className="chat-heading">
            <div>
              <span className="eyebrow"><Sparkles className="size-3.5" /> LIVE SESSION</span>
              <h2>和 Supervisor 对话</h2>
            </div>
            <span className="session-mark">会话仅保留在当前进程</span>
          </div>
          <div className="chat-scroll">
            <MessageList
              historyLoading={chat.historyLoading}
              messages={chat.messages}
              status={chat.status}
            />
          </div>
          {chat.errorMessage && <div className="error-banner" role="alert">{chat.errorMessage}</div>}
          <ChatComposer
            disabled={streaming || chat.historyLoading}
            onSend={(text) => chat.sendMessage({ text })}
            onStop={chat.stop}
            streaming={streaming}
          />
        </div>
      </section>
      <footer className="page-footer">MAS­TRA SUPERVISOR · AI SDK V6 · NEXT.JS</footer>
    </main>
  );
}

export function ChatShell() {
  const [identity, setIdentity] = useState<MemoryIdentity | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setIdentity(getSessionIdentity()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (!identity) {
    return <main className="boot-screen">正在准备会话...</main>;
  }

  return <ChatWorkspace identity={identity} />;
}
