import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  deleteAdvisorSession,
  listAdvisorSessions,
  listOnboardingMessages,
  sendAdvisorMessage,
} from "@/services/advisorService";
import type { AdvisorSessionSummary, AdvisorTrace as AdvisorTraceModel, OnboardingMessage } from "@/types/app/onboarding";
import { toast } from "sonner";
import {
  Archive,
  Camera,
  FileText,
  Image,
  MoreHorizontal,
  MessageSquarePlus,
  Mic,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  SearchCheck,
  Send,
  Share2,
  Sparkles,
  Table2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import AdvisorTrace from "@/components/desktop/AdvisorTrace";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const SUGGESTIONS = [
  "我想三年后在杭州付首付，月入 2 万，帮我建档",
  "我 28 岁，存款 15 万，怕股票暴跌，想学理财",
  "我有房贷，孩子明年上幼儿园，想给她攒教育金",
  "帮我算算这笔钱够不够 60 岁前退休",
];

const PLUS_UPLOAD_TOOLS = [
  {
    label: "截图上传",
    icon: Camera,
    upload: true,
    prompt: "请帮我识别这张截图，并提取其中的关键信息：",
  },
  {
    label: "文件上传",
    icon: Upload,
    upload: true,
  },
];

const ACTION_TOOLS = [
  {
    label: "AI 表格",
    icon: Table2,
    prompt: "请帮我生成一张结构清晰的 AI 表格，用来整理：",
  },
  {
    label: "图像生成",
    icon: Image,
    prompt: "请帮我生成一张图像，画面要求是：",
  },
  {
    label: "报告生成",
    icon: FileText,
    prompt: "请帮我生成一份专业报告，主题是：",
  },
  {
    label: "深度研究",
    icon: SearchCheck,
    prompt: "请围绕这个主题做一次深度研究，并给出结论、证据和风险：",
  },
];

const MOCK_SESSION_PREFIX = "mock-advisor-session-";

const MOCK_ADVISOR_SESSIONS: AdvisorSessionSummary[] = [
  {
    sessionId: `${MOCK_SESSION_PREFIX}business-exception`,
    title: "BusinessException 使用建议",
    messageCount: 4,
    lastActivityAt: new Date(Date.now() - 8 * 60_000).toISOString(),
    firstActivityAt: new Date(Date.now() - 36 * 60_000).toISOString(),
  },
  {
    sessionId: `${MOCK_SESSION_PREFIX}agent-product`,
    title: "创新 agent 产品点子",
    messageCount: 6,
    lastActivityAt: new Date(Date.now() - 46 * 60_000).toISOString(),
    firstActivityAt: new Date(Date.now() - 78 * 60_000).toISOString(),
  },
  {
    sessionId: `${MOCK_SESSION_PREFIX}tree-debug`,
    title: "二叉树构建错误分析",
    messageCount: 3,
    lastActivityAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
    firstActivityAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
  },
  {
    sessionId: `${MOCK_SESSION_PREFIX}log-level`,
    title: "日志级别区别解释",
    messageCount: 5,
    lastActivityAt: new Date(Date.now() - 5 * 60 * 60_000).toISOString(),
    firstActivityAt: new Date(Date.now() - 6 * 60 * 60_000).toISOString(),
  },
];

const MOCK_MESSAGES: Record<string, OnboardingMessage[]> = {
  [`${MOCK_SESSION_PREFIX}business-exception`]: [
    {
      id: "mock-business-user",
      role: "user",
      content: "BusinessException 应该怎么设计才适合业务层使用？",
      metadata: {},
      createdAt: new Date(Date.now() - 36 * 60_000).toISOString(),
      sessionId: `${MOCK_SESSION_PREFIX}business-exception`,
    },
    {
      id: "mock-business-advisor",
      role: "advisor",
      content: "建议把 BusinessException 保持为明确、可分类、可观测的业务错误：包含 code、message、可选 detail，并在边界层统一转成接口响应。这样调用方可以按 code 判断，日志也能快速聚合。",
      metadata: {},
      createdAt: new Date(Date.now() - 34 * 60_000).toISOString(),
      sessionId: `${MOCK_SESSION_PREFIX}business-exception`,
    },
  ],
  [`${MOCK_SESSION_PREFIX}agent-product`]: [
    {
      id: "mock-agent-user",
      role: "user",
      content: "帮我想几个创新 agent 产品点子。",
      metadata: {},
      createdAt: new Date(Date.now() - 78 * 60_000).toISOString(),
      sessionId: `${MOCK_SESSION_PREFIX}agent-product`,
    },
    {
      id: "mock-agent-advisor",
      role: "advisor",
      content: "可以从高频工作流入手：财务目标规划 agent、会议纪要到项目计划 agent、数据表清洗 agent。每个点子都要绑定明确输入、输出和验收标准。",
      metadata: {},
      createdAt: new Date(Date.now() - 76 * 60_000).toISOString(),
      sessionId: `${MOCK_SESSION_PREFIX}agent-product`,
    },
  ],
  [`${MOCK_SESSION_PREFIX}tree-debug`]: [
    {
      id: "mock-tree-user",
      role: "user",
      content: "二叉树构建结果不对，帮我看思路。",
      metadata: {},
      createdAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
      sessionId: `${MOCK_SESSION_PREFIX}tree-debug`,
    },
    {
      id: "mock-tree-advisor",
      role: "advisor",
      content: "优先检查递归边界、左右子树区间是否闭合一致，以及根节点索引是否在每一层正确推进。大多数错误都来自区间 off-by-one。",
      metadata: {},
      createdAt: new Date(Date.now() - 2.9 * 60 * 60_000).toISOString(),
      sessionId: `${MOCK_SESSION_PREFIX}tree-debug`,
    },
  ],
  [`${MOCK_SESSION_PREFIX}log-level`]: [
    {
      id: "mock-log-user",
      role: "user",
      content: "日志级别怎么区分？",
      metadata: {},
      createdAt: new Date(Date.now() - 6 * 60 * 60_000).toISOString(),
      sessionId: `${MOCK_SESSION_PREFIX}log-level`,
    },
    {
      id: "mock-log-advisor",
      role: "advisor",
      content: "DEBUG 用于开发定位，INFO 记录关键业务路径，WARN 表示可恢复但需要关注，ERROR 表示请求或任务失败，FATAL 则是进程级不可恢复问题。",
      metadata: {},
      createdAt: new Date(Date.now() - 5.9 * 60 * 60_000).toISOString(),
      sessionId: `${MOCK_SESSION_PREFIX}log-level`,
    },
  ],
};

const isMockSession = (sessionId: string) => sessionId.startsWith(MOCK_SESSION_PREFIX);

const AdvisorPage = () => {
  const { user, refreshProfile } = useAuth();
  const [sessions, setSessions] = useState<AdvisorSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => crypto.randomUUID());
  const [messages, setMessages] = useState<OnboardingMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [toolboxOpen, setToolboxOpen] = useState(false);
  const [sessionMenuId, setSessionMenuId] = useState<string | null>(null);
  const [pinnedSessionIds, setPinnedSessionIds] = useState<Set<string>>(() => new Set());
  const [deletedMockSessionIds, setDeletedMockSessionIds] = useState<Set<string>>(() => new Set());
  const [pendingUploadPrompt, setPendingUploadPrompt] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mockSessions = useMemo(
    () => MOCK_ADVISOR_SESSIONS.filter((session) => !deletedMockSessionIds.has(session.sessionId)),
    [deletedMockSessionIds],
  );

  const visibleSessions = sessions.length ? sessions : mockSessions;

  const activeSession = useMemo(
    () => visibleSessions.find((s) => s.sessionId === activeSessionId) ?? null,
    [activeSessionId, visibleSessions],
  );

  const orderedSessions = useMemo(() => {
    return [...visibleSessions].sort((a, b) => {
      const pinnedDelta = Number(pinnedSessionIds.has(b.sessionId)) - Number(pinnedSessionIds.has(a.sessionId));
      if (pinnedDelta) return pinnedDelta;
      return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
    });
  }, [pinnedSessionIds, visibleSessions]);

  const refreshSessions = useCallback(async () => {
    if (!user) return;
    setLoadingSessions(true);
    try {
      const data = await listAdvisorSessions(user.id);
      setSessions(data);
      return data;
    } catch (err: any) {
      toast.error(err?.message ?? "历史会话加载失败");
      return [];
    } finally {
      setLoadingSessions(false);
    }
  }, [user]);

  const loadSessionMessages = useCallback(async (sessionId: string) => {
    if (isMockSession(sessionId)) {
      setLoadingHistory(false);
      setMessages(MOCK_MESSAGES[sessionId] ?? []);
      return;
    }
    if (!user) return;
    setLoadingHistory(true);
    try {
      const rows = await listOnboardingMessages(user.id, sessionId);
      setMessages(rows);
    } catch (err: any) {
      toast.error(err?.message ?? "对话加载失败");
    } finally {
      setLoadingHistory(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const data = await refreshSessions();
      if (data && data.length) {
        setActiveSessionId(data[0].sessionId);
        await loadSessionMessages(data[0].sessionId);
      } else {
        const firstMockSession = MOCK_ADVISOR_SESSIONS[0];
        setActiveSessionId(firstMockSession.sessionId);
        setMessages(MOCK_MESSAGES[firstMockSession.sessionId] ?? []);
      }
    })();
  }, [user, refreshSessions, loadSessionMessages]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const openSession = async (sessionId: string) => {
    if (sending) return;
    setSessionMenuId(null);
    setActiveSessionId(sessionId);
    await loadSessionMessages(sessionId);
  };

  const handleNewSession = () => {
    if (sending) return;
    setMessages([]);
    setDraft("");
    setSessionMenuId(null);
    setActiveSessionId(crypto.randomUUID());
  };

  const togglePinSession = (sessionId: string, ev?: React.MouseEvent) => {
    ev?.stopPropagation();
    setPinnedSessionIds((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
    setSessionMenuId(null);
  };

  const handleSessionMenuAction = (action: string, sessionId: string) => {
    if (action === "delete") {
      void handleDeleteSession(sessionId);
      setSessionMenuId(null);
      return;
    }
    if (action === "pin") {
      togglePinSession(sessionId);
      return;
    }
    const labels: Record<string, string> = {
      share: "分享入口已准备好",
      rename: "重命名入口已准备好",
      archive: "归档入口已准备好",
    };
    toast.info(labels[action] ?? "操作入口已准备好");
    setSessionMenuId(null);
  };

  const handleDeleteSession = async (sessionId: string, ev?: React.MouseEvent) => {
    ev?.stopPropagation();
    if (isMockSession(sessionId)) {
      setDeletedMockSessionIds((current) => new Set(current).add(sessionId));
      setPinnedSessionIds((current) => {
        const next = new Set(current);
        next.delete(sessionId);
        return next;
      });
      setSessionMenuId(null);
      toast.success("已从演示列表移除");
      if (sessionId === activeSessionId) {
        const nextSession = mockSessions.find((session) => session.sessionId !== sessionId);
        if (nextSession) {
          setActiveSessionId(nextSession.sessionId);
          setMessages(MOCK_MESSAGES[nextSession.sessionId] ?? []);
        } else {
          handleNewSession();
        }
      }
      return;
    }
    if (!user) return;
    if (!confirm("删除这段会话（含所有消息）？")) return;
    try {
      await deleteAdvisorSession(user.id, sessionId);
      toast.success("会话已删除");
      const data = await refreshSessions();
      if (sessionId === activeSessionId) {
        if (data && data.length) {
          setActiveSessionId(data[0].sessionId);
          await loadSessionMessages(data[0].sessionId);
        } else {
          handleNewSession();
        }
      }
    } catch (err: any) {
      toast.error(err?.message ?? "删除失败");
    }
  };

  const send = async (text: string) => {
    if (!user || !text.trim() || sending) return;
    setSending(true);
    const currentSessionId = activeSessionId;
    const optimistic: OnboardingMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: text.trim(),
      metadata: {},
      createdAt: new Date().toISOString(),
      sessionId: currentSessionId,
    };
    setMessages((m) => [...m, optimistic]);
    setDraft("");
    try {
      const { reply, profileUpdate, trace, sessionId: returnedSid } = await sendAdvisorMessage(text.trim(), currentSessionId);
      const meta: Record<string, unknown> = {};
      if (profileUpdate) meta.profileUpdate = profileUpdate;
      if (trace) meta.trace = trace;
      setMessages((m) => [
        ...m,
        {
          id: `advisor-${Date.now()}`,
          role: "advisor",
          content: reply,
          metadata: meta,
          createdAt: new Date().toISOString(),
          sessionId: returnedSid ?? currentSessionId,
        },
      ]);
      if (profileUpdate) {
        toast.success("已更新你的财务档案");
        await refreshProfile();
      }
      void refreshSessions();
    } catch (err: any) {
      toast.error(err?.message ?? "顾问 Agent 暂时无响应");
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
    } finally {
      setSending(false);
    }
  };

  const handleSend = () => {
    if (sending) return;
    const trimmed = draft.trim();
    if (!trimmed && !attachment) return;
    const composed = attachment
      ? `[附件：${attachment.name}]${trimmed ? `\n${trimmed}` : ""}`
      : trimmed;
    send(composed);
    setAttachment(null);
  };

  const handleToolAction = (tool: (typeof ACTION_TOOLS)[number] | (typeof PLUS_UPLOAD_TOOLS)[number]) => {
    setToolboxOpen(false);
    if (tool.upload) {
      setPendingUploadPrompt(tool.prompt ?? null);
      fileInputRef.current?.click();
      return;
    }
    if (tool.prompt) {
      setDraft((current) => current.trim() ? current : tool.prompt);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  const emptyChatState = messages.length === 0 && !loadingHistory;

  return (
    <div className="flex h-full min-h-[640px] w-full gap-0 overflow-hidden border-y border-border bg-card">
      <aside className="flex w-[302px] shrink-0 flex-col border-r border-neutral-200 bg-[#f7f7f7] text-neutral-950">
        <div className="flex items-center justify-between px-3 pb-4 pt-3">
          <button
            onClick={handleNewSession}
            className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-2xl px-3 text-left text-[15px] font-medium transition-colors hover:bg-neutral-200/80"
          >
            <MessageSquarePlus className="size-5 shrink-0" />
            <span className="truncate">新对话</span>
          </button>
        </div>
        <div className="px-4 pb-2 text-[17px] font-semibold text-neutral-950">
          最近
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {loadingSessions ? (
            <p className="px-3 py-2 text-sm text-neutral-500">加载中…</p>
          ) : visibleSessions.length === 0 ? (
            <p className="px-3 py-4 text-sm leading-6 text-neutral-500">还没有历史会话。开始第一条消息，就会记入档案。</p>
          ) : (
            <ul className="space-y-0.5">
              {orderedSessions.map((s) => {
                const isActive = s.sessionId === activeSessionId;
                const isPinned = pinnedSessionIds.has(s.sessionId);
                const menuOpen = sessionMenuId === s.sessionId;
                return (
                  <li key={s.sessionId} className="group/session relative">
                    <button
                      onClick={() => openSession(s.sessionId)}
                      className={cn(
                        "group flex h-[42px] w-full items-center rounded-2xl py-0 pl-3 pr-[74px] text-left text-[15px] leading-none transition-colors",
                        isActive || menuOpen ? "bg-neutral-200/90" : "hover:bg-neutral-200/70",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {s.title}
                      </span>
                    </button>
                    <div
                      className={cn(
                        "absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-full bg-neutral-200/90 opacity-0 transition-opacity",
                        (isActive || menuOpen || isPinned) && "opacity-100",
                        "group-hover/session:opacity-100",
                      )}
                    >
                      <button
                        type="button"
                        onClick={(ev) => togglePinSession(s.sessionId, ev)}
                        className={cn("grid size-8 place-items-center rounded-full text-neutral-500 hover:bg-neutral-300/70 hover:text-neutral-950", isPinned && "text-neutral-950")}
                        aria-label={isPinned ? "取消置顶" : "置顶聊天"}
                      >
                        <Pin className="size-4" />
                      </button>
                      <DropdownMenu open={menuOpen} onOpenChange={(open) => setSessionMenuId(open ? s.sessionId : null)}>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            onClick={(ev) => ev.stopPropagation()}
                            className="grid size-8 place-items-center rounded-full text-neutral-700 hover:bg-neutral-300/70 hover:text-neutral-950"
                            aria-label="更多操作"
                          >
                            <MoreHorizontal className="size-5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          side="right"
                          align="start"
                          sideOffset={10}
                          className="w-[184px] rounded-[22px] border-neutral-200 bg-white p-2 text-neutral-950 shadow-[0_18px_44px_rgba(0,0,0,0.16)]"
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          <DropdownMenuItem onSelect={() => handleSessionMenuAction("share", s.sessionId)} className="flex h-11 cursor-pointer items-center gap-3 rounded-2xl px-3 text-[15px] focus:bg-neutral-100">
                            <Share2 className="size-5" />
                            <span>分享</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => handleSessionMenuAction("rename", s.sessionId)} className="flex h-11 cursor-pointer items-center gap-3 rounded-2xl px-3 text-[15px] focus:bg-neutral-100">
                            <Pencil className="size-5" />
                            <span>重命名</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => handleSessionMenuAction("pin", s.sessionId)} className="flex h-11 cursor-pointer items-center gap-3 rounded-2xl px-3 text-[15px] focus:bg-neutral-100">
                            <Pin className="size-5" />
                            <span>{isPinned ? "取消置顶" : "置顶聊天"}</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => handleSessionMenuAction("archive", s.sessionId)} className="flex h-11 cursor-pointer items-center gap-3 rounded-2xl px-3 text-[15px] focus:bg-neutral-100">
                            <Archive className="size-5" />
                            <span>归档</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => handleSessionMenuAction("delete", s.sessionId)} className="flex h-11 cursor-pointer items-center gap-3 rounded-2xl px-3 text-[15px] text-red-600 focus:bg-red-50 focus:text-red-600">
                            <Trash2 className="size-5" />
                            <span>删除</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-6 py-3">
          <div className="min-w-0">
            <p className="line-clamp-1 text-sm font-medium">{activeSession?.title ?? "新对话"}</p>
          </div>
        </header>

        <div ref={listRef} className="flex-1 overflow-y-auto px-6 py-6">
          {loadingHistory ? (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">加载对话…</div>
          ) : emptyChatState ? (
            <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center text-center">
              <div className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
                <Sparkles className="size-5" />
              </div>
              <h2 className="mt-5 text-2xl font-semibold tracking-tight">有什么我能帮你的吗？</h2>
              <p className="mt-2 text-sm text-muted-foreground">先说一句你现在最想解决的钱事，我来把它拆成能执行的画像与目标。</p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => { setAttachment(null); send(s); }}
                    className="rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ul className="mx-auto flex max-w-2xl flex-col gap-5">
              {messages.map((msg) => {
                const meta = (msg.metadata ?? {}) as { profileUpdate?: Record<string, unknown>; trace?: AdvisorTraceModel };
                return (
                  <li key={msg.id} className={cn("flex gap-3", msg.role === "user" ? "justify-end" : "justify-start")}>
                    {msg.role !== "user" && (
                      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        顾问
                      </div>
                    )}
                    <div className={cn("min-w-0", msg.role === "user" ? "max-w-[80%]" : "flex-1")}>
                      <div
                        className={cn(
                          "whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6",
                          msg.role === "user"
                            ? "inline-block bg-primary text-primary-foreground"
                            : "bg-muted text-foreground",
                        )}
                      >
                        {msg.content}
                        {msg.role === "advisor" && meta.profileUpdate ? (
                          <div className="mt-3 rounded border border-destructive/30 bg-card px-3 py-2 text-[11px] text-destructive">
                            ✓ 已把这段信息写入你的财务档案
                          </div>
                        ) : null}
                      </div>
                      {msg.role === "advisor" && meta.trace ? <AdvisorTrace trace={meta.trace} /> : null}
                    </div>
                  </li>
                );
              })}
              {sending && (
                <li className="flex gap-3">
                  <div className="grid size-8 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">顾问</div>
                  <div className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">思考中…</div>
                </li>
              )}
            </ul>
          )}
        </div>

        <div className="px-6">
          <div className="mx-auto mb-6 max-w-[1100px]">
            <div
              className="relative rounded-[28px] border bg-white p-3 shadow-[0_18px_48px_rgba(37,99,235,0.12)] transition-all hover:border-transparent hover:shadow-[0_18px_54px_rgba(37,99,235,0.22)]"
              style={{ borderColor: "rgba(96, 165, 250, 0.35)" }}
              onClick={() => {
                setToolboxOpen(false);
                textareaRef.current?.focus();
              }}
            >
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="发消息…"
                rows={2}
                className="w-full min-h-[52px] resize-none border-0 bg-transparent px-2 py-1 text-sm text-neutral-900 tracking-wide caret-blue-600 outline-none placeholder:text-neutral-400"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />

              {attachment ? (
                <div className="mx-2 mb-1 flex w-fit items-center gap-1.5 rounded-xl bg-blue-50 px-2 py-1 text-xs text-blue-700">
                  <Paperclip className="size-3" />
                  <span className="max-w-[220px] truncate">{attachment.name}</span>
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setAttachment(null);
                    }}
                    className="ml-0.5 rounded-full text-blue-500 transition-colors hover:text-blue-700"
                    aria-label="移除附件"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ) : null}

              <div className="mt-1 flex items-center gap-2 overflow-x-auto px-1 pb-0.5">
                <button
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setToolboxOpen((open) => !open);
                  }}
                  className="grid size-12 shrink-0 place-items-center rounded-full bg-neutral-100 text-neutral-900 transition-colors hover:bg-neutral-200"
                  aria-label="展开工具"
                >
                  <Plus className="size-6" />
                </button>
                {toolboxOpen ? (
                  <div
                    className="absolute bottom-[70px] left-3 z-20 w-[236px] overflow-hidden rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-[0_18px_48px_rgba(15,23,42,0.16)]"
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    <div className="py-1">
                      {PLUS_UPLOAD_TOOLS.map((tool) => {
                        const Icon = tool.icon;
                        return (
                          <button
                            key={tool.label}
                            type="button"
                            onClick={() => handleToolAction(tool)}
                            className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-100"
                          >
                            <Icon className="size-4" />
                            <span>{tool.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <span className="h-7 w-px shrink-0 bg-neutral-200" />
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    if (f) {
                      setAttachment(f);
                      if (pendingUploadPrompt) {
                        setDraft((current) => current.trim() ? current : pendingUploadPrompt);
                      }
                      toast.info(`已选择文件：${f.name}`);
                    }
                    setPendingUploadPrompt(null);
                    e.target.value = "";
                  }}
                />
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  {ACTION_TOOLS.map((tool) => {
                    const Icon = tool.icon;
                    return (
                      <button
                        key={tool.label}
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          handleToolAction(tool);
                        }}
                        className="flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-100"
                      >
                        <Icon className="size-4" />
                        <span>{tool.label}</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    toast.info("语音输入入口已准备好，后续可接入录音转写。");
                  }}
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-neutral-100 text-neutral-900 transition-colors hover:bg-neutral-200"
                  aria-label="语音输入"
                >
                  <Mic className="size-5" />
                </button>
                <button
                  onClick={(ev) => {
                    ev.stopPropagation();
                    handleSend();
                  }}
                  disabled={sending || (!draft.trim() && !attachment)}
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="发送"
                >
                  <Send className="size-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AdvisorPage;
