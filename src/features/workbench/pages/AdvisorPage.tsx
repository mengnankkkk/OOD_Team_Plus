import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  deleteAdvisorSession,
  listAdvisorSessions,
  listOnboardingMessages,
  sendAdvisorMessageStream,
} from "@/services/advisorService";
import {
  continueDebateMessage,
  isDebatePackSettled,
  isDebateSessionUnavailable,
  loadDebatePack,
  resumeDebateMessage,
  startDebateMessage,
  type DebatePack,
  type DebateRole,
  type DebateStreamActivity,
} from "@/services/debateService";
import type { AdvisorSessionSummary, AdvisorTrace as AdvisorTraceModel, ConversationOutputMode, DebateSuggestion, OnboardingMessage } from "@/types/app/onboarding";
import { toast } from "sonner";
import {
  Archive,
  Camera,
  Check,
  ChevronDown,
  FileText,
  Fingerprint,
  Image as ImageIcon,
  MoreHorizontal,
  MessageSquarePlus,
  Mic,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  SearchCheck,
  Search,
  Send,
  Share2,
  Swords,
  Sparkles,
  Table2,
  TrendingDown,
  TrendingUp,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import AdvisorTrace from "@/components/desktop/AdvisorTrace";
import DebateCharacterStage from "@/features/workbench/components/DebateCharacterStage";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useSearchParams } from "@/features/frontend-migration/router";
import { useNavigate } from "@/features/frontend-migration/router";
import { recordRecommendationDecision } from "@/services/recommendationService";
import { saveInjectiveProofDraft } from "@/lib/injective-proof";

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
    icon: ImageIcon,
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

type AdvisorMode = "normal" | "debate";
type DebateSuggestionWithTarget = DebateSuggestion & { targetSymbol?: string | null };
type AdvisorMessageMeta = {
  profileUpdate?: Record<string, unknown>;
  trace?: AdvisorTraceModel;
  recommendationId?: string;
  streaming?: boolean;
  streamStatus?: string;
  thinkingSteps?: Array<{ key: string; title: string; content: string }>;
  debatePack?: DebatePack;
  debateSuggestion?: DebateSuggestion;
};
type DebateHistoryRole = "user" | "evidence" | "bull" | "bear" | "judge";
type DebateHistoryEntry = {
  id: string;
  role: DebateHistoryRole;
  label: string;
  text: string;
  roundLabel?: string;
};

const ADVISOR_MODES: Array<{ value: AdvisorMode; label: string }> = [
  { value: "normal", label: "普通模式" },
  { value: "debate", label: "辩论模式" },
];

const DEBATE_ROLES: Array<{ value: DebateRole; label: string; icon: typeof Swords }> = [
  { value: "neutral", label: "中立", icon: Swords },
  { value: "bull", label: "站多", icon: TrendingUp },
  { value: "bear", label: "站空", icon: TrendingDown },
];

const AdvisorPage = () => {
  const { user, refreshProfile } = useAuth();
  const [searchParams] = useSearchParams();
  const requestedConversationId = searchParams.get("conversationId");
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<AdvisorSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<OnboardingMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [outputMode] = useState<ConversationOutputMode>("SQL_ONLY");
  const [advisorMode, setAdvisorMode] = useState<AdvisorMode>("normal");
  const [debateTransitioning, setDebateTransitioning] = useState(false);
  const [debateTransitionTarget, setDebateTransitionTarget] = useState<AdvisorMode>("debate");
  const [debateUserRole, setDebateUserRole] = useState<DebateRole>("neutral");
  const [activeDebateSessionId, setActiveDebateSessionId] = useState<string | null>(null);
  const [debateActivity, setDebateActivity] = useState<DebateStreamActivity | null>(null);
  const [pendingDebateContext, setPendingDebateContext] = useState<{ motion: string; targetSymbol: string | null } | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [toolboxOpen, setToolboxOpen] = useState(false);
  const [sessionMenuId, setSessionMenuId] = useState<string | null>(null);
  const [sessionSearch, setSessionSearch] = useState("");
  const [pinnedSessionIds, setPinnedSessionIds] = useState<Set<string>>(() => new Set());
  const [pendingUploadPrompt, setPendingUploadPrompt] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyRequestRef = useRef(0);
  const appliedPromptRef = useRef<string | null>(null);
  const modeTransitionTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (modeTransitionTimerRef.current !== null) window.clearTimeout(modeTransitionTimerRef.current);
  }, []);

  const switchAdvisorMode = useCallback((mode: AdvisorMode) => {
    if (mode === advisorMode) return;
    if (modeTransitionTimerRef.current !== null) window.clearTimeout(modeTransitionTimerRef.current);
    setDebateTransitionTarget(mode);
    setDebateTransitioning(true);
    setAdvisorMode(mode);
    if (mode === "normal") setPendingDebateContext(null);
    modeTransitionTimerRef.current = window.setTimeout(() => {
      setDebateTransitioning(false);
      modeTransitionTimerRef.current = null;
    }, 620);
  }, [advisorMode]);

  const visibleSessions = useMemo(() => {
    const keyword = sessionSearch.trim().toLowerCase();
    if (!keyword) return sessions;
    return sessions.filter((session) => session.title.toLowerCase().includes(keyword));
  }, [sessionSearch, sessions]);

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
    if (!user) return;
    const requestId = ++historyRequestRef.current;
    setLoadingHistory(true);
    try {
      const rows = await listOnboardingMessages(user.id, sessionId);
      if (requestId !== historyRequestRef.current) return;
      setMessages(rows);
      setLoadingHistory(false);

      const restoredDebate = restoredDebateState(rows);
      setActiveDebateSessionId(restoredDebate?.debateSessionId ?? null);
      setDebateActivity(restoredDebate ? { role: "moderator", phase: "completed", eventType: "history.restored" } : null);
      setPendingDebateContext(null);
      if (!restoredDebate) {
        setAdvisorMode("normal");
        setDebateUserRole("neutral");
        return;
      }

      setAdvisorMode("debate");
      setDebateUserRole(restoredDebate.userRole);
      const restoredPackPromise = loadDebatePack(restoredDebate.debateSessionId);
      const restoredRows = await attachDebatePacks(rows, (debateSessionId) => (
        debateSessionId === restoredDebate.debateSessionId
          ? restoredPackPromise
          : loadDebatePack(debateSessionId)
      ));
      if (requestId !== historyRequestRef.current) return;
      setMessages(restoredRows);

      const restoredPack = await restoredPackPromise.catch(() => null);
      if (!restoredPack) {
        setActiveDebateSessionId(null);
        return;
      }
      if (restoredPack.status.toUpperCase() === "BLOCKED") {
        setActiveDebateSessionId(null);
        return;
      }
      if (restoredDebate.roundIndex === null || isDebatePackSettled(restoredPack, restoredDebate.roundIndex)) return;

      const streamMessageId = `debate-resume-${restoredDebate.debateSessionId}-${restoredDebate.roundIndex}`;
      setMessages((current) => [...current, {
        id: streamMessageId,
        role: "advisor",
        content: "多空双方正在继续本轮 Battle…",
        metadata: {
          streaming: true,
          streamStatus: "正在恢复多空 Battle",
          debateSessionId: restoredDebate.debateSessionId,
          roundIndex: restoredDebate.roundIndex,
        },
        createdAt: new Date().toISOString(),
        sessionId,
      }]);
      await resumeDebateMessage(
        restoredDebate.debateSessionId,
        restoredDebate.roundIndex,
        {
          onProgress: (status) => {
            if (requestId !== historyRequestRef.current) return;
            setMessages((current) => current.map((message) => (
              message.id === streamMessageId
                ? { ...message, metadata: { ...message.metadata, streamStatus: status } }
                : message
            )));
          },
          onActivity: (activity) => {
            if (requestId === historyRequestRef.current) setDebateActivity(activity);
          },
        },
      );
      if (requestId !== historyRequestRef.current) return;
      const completedRows = await listOnboardingMessages(user.id, sessionId);
      if (requestId !== historyRequestRef.current) return;
      const completedRestoredRows = await attachDebatePacks(completedRows);
      if (requestId !== historyRequestRef.current) return;
      setMessages(completedRestoredRows);
    } catch (err: any) {
      if (requestId !== historyRequestRef.current) return;
      toast.error(err?.message ?? "对话加载失败");
    } finally {
      if (requestId === historyRequestRef.current) setLoadingHistory(false);
    }
  }, [user]);

  const resetBattleState = useCallback(() => {
    historyRequestRef.current += 1;
    setMessages([]);
    setDraft("");
    setSessionMenuId(null);
    setLoadingHistory(false);
    setActiveSessionId(null);
    setActiveDebateSessionId(null);
    setDebateActivity(null);
    setPendingDebateContext(null);
    setDebateUserRole("neutral");
  }, []);

  const resetToNewSession = useCallback(() => {
    resetBattleState();
    setAdvisorMode("normal");
  }, [resetBattleState]);

  const handleNewSession = useCallback(() => {
    if (sending) return;
    resetToNewSession();
  }, [resetToNewSession, sending]);

  const handleNewDebate = useCallback(() => {
    if (sending) return;
    resetBattleState();
    switchAdvisorMode("debate");
  }, [resetBattleState, sending, switchAdvisorMode]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const selectionVersion = historyRequestRef.current;
      const data = await refreshSessions();
      if (selectionVersion !== historyRequestRef.current) return;
      if (data && data.length) {
        const requested = requestedConversationId
          ? data.find((session) => session.sessionId === requestedConversationId)
          : null;
        const next = requested ?? data[0];
        setActiveSessionId(next.sessionId);
        await loadSessionMessages(next.sessionId);
      } else {
        resetToNewSession();
      }
    })();
  }, [user, refreshSessions, loadSessionMessages, requestedConversationId, resetToNewSession]);

  useEffect(() => {
    const prompt = searchParams.get("prompt")?.trim();
    if (!prompt || appliedPromptRef.current === prompt) return;
    appliedPromptRef.current = prompt;
    resetToNewSession();
    setDraft(prompt.slice(0, 4_000));
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [resetToNewSession, searchParams]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });

    if (window.matchMedia("(max-width: 767px)").matches) {
      requestAnimationFrame(() => {
        composerRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    }
  }, [advisorMode, messages, sending]);

  const openSession = async (sessionId: string) => {
    if (sending) return;
    setSessionMenuId(null);
    setMessages([]);
    setActiveSessionId(sessionId);
    setActiveDebateSessionId(null);
    setDebateActivity(null);
    setPendingDebateContext(null);
    setAdvisorMode("normal");
    setDebateUserRole("neutral");
    await loadSessionMessages(sessionId);
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

  const sendDebate = async (text: string, role: DebateRole, forceNewDebate = false) => {
    if (!user || !text.trim() || sending) return;
    setSending(true);
    const currentSessionId = activeSessionId;
    const optimistic: OnboardingMessage = {
      id: `local-debate-${Date.now()}`,
      role: "user",
      content: text.trim(),
      metadata: { debateRole: role },
      createdAt: new Date().toISOString(),
      sessionId: currentSessionId,
    };
    const streamMessageId = `debate-stream-${Date.now()}`;
    setMessages((m) => [...m, optimistic, {
      id: streamMessageId,
      role: "advisor",
      content: "",
      metadata: { streaming: true, streamStatus: "正在开启多空 Battle" },
      createdAt: new Date().toISOString(),
      sessionId: currentSessionId,
    }]);
    setDebateActivity({ role: "user", phase: "started", eventType: "ui.user.submitted" });
    setDraft("");
    try {
      const observer = {
        onProgress: updateDebateProgress(streamMessageId),
        onActivity: setDebateActivity,
      };
      let result;
      try {
        result = activeDebateSessionId && !forceNewDebate
          ? await continueDebateMessage(activeDebateSessionId, text.trim(), role, observer)
          : await startDebateMessage(
              text.trim(),
              currentSessionId,
              role,
              observer,
              pendingDebateContext?.motion.trim() === text.trim() ? pendingDebateContext.targetSymbol : null,
            );
      } catch (error) {
        if (!activeDebateSessionId || forceNewDebate || !isDebateSessionUnavailable(error)) throw error;
        setActiveDebateSessionId(null);
        updateDebateProgress(streamMessageId)("旧 Battle 已失效，正在重新开启一场 Battle");
        result = await startDebateMessage(
          text.trim(),
          currentSessionId,
          role,
          observer,
          pendingDebateContext?.motion.trim() === text.trim() ? pendingDebateContext.targetSymbol : null,
        );
      }
      const returnedSid = result.sessionId || currentSessionId;
      const roundId = latestDebateRoundId(result.pack);
      const messageMetadata = {
        debateMotion: result.pack.motion,
        publication: result.pack.publication,
      };
      const messagePack = roundId
        ? selectDebateRoundPack(result.pack, roundId, messageMetadata)
        : result.pack;
      if (returnedSid && returnedSid !== currentSessionId) setActiveSessionId(returnedSid);
      setAdvisorMode("debate");
      setActiveDebateSessionId(result.pack.status.toUpperCase() === "BLOCKED" ? null : result.debateSessionId);
      setPendingDebateContext(null);
      setMessages((m) => m.map((item) => item.id === optimistic.id || item.id === streamMessageId
        ? { ...item, sessionId: returnedSid ?? currentSessionId }
        : item));
      setMessages((m) => m.map((item) => item.id === streamMessageId ? {
        ...item,
        id: `debate-${Date.now()}`,
        role: "advisor",
        content: result.reply,
        metadata: {
          debatePack: messagePack,
          debateSessionId: result.debateSessionId,
          roundId,
          ...messageMetadata,
        },
        createdAt: new Date().toISOString(),
        sessionId: returnedSid ?? currentSessionId,
      } : item));
      void refreshSessions();
    } catch (err: any) {
      toast.error(err?.message ?? "多空 Battle 暂时无响应");
      if (activeDebateSessionId && isDebateSessionUnavailable(err)) setActiveDebateSessionId(null);
      setMessages((m) => m.filter((x) => x.id !== optimistic.id && x.id !== streamMessageId));
    } finally {
      setSending(false);
    }
  };

  const updateDebateProgress = (messageId: string) => (status: string) => {
    setMessages((items) => items.map((item) => item.id === messageId ? {
      ...item,
      content: item.content || "多空双方正在准备观点…",
      metadata: { ...item.metadata, streaming: true, streamStatus: status },
    } : item));
  };

  const latestDebatePack = useMemo(
    () => latestDebatePackFromMessages(messages),
    [messages],
  );
  const debateHistory = useMemo(
    () => debateHistoryEntries(messages),
    [messages],
  );
  const isNewBattleDraft = advisorMode === "debate" && !activeDebateSessionId && Boolean(pendingDebateContext);
  const stagePack = sending || isNewBattleDraft ? null : latestDebatePack;
  const stageJudgement = stagePack?.judgements.at(-1);
  const stageBull = stagePack ? latestDebateTurn(stagePack, "bull")?.publicSummary ?? stageJudgement?.bullStrongestPoint ?? null : null;
  const stageBear = stagePack ? latestDebateTurn(stagePack, "bear")?.publicSummary ?? stageJudgement?.bearStrongestPoint ?? null : null;
  const stageJudge = stagePack ? stageJudgement?.whyNotFinal ?? null : null;
  const stageUser = isNewBattleDraft
    ? [...messages].reverse().find((message) => message.id.startsWith("local-debate-"))?.content ?? null
    : latestDebateUserMessage(messages)?.content ?? null;
  const stageMotion = pendingDebateContext?.motion ?? stagePack?.motion ?? null;
  const streamingStatus = [...messages].reverse().find((message) => (
    message.role === "advisor" && Boolean((message.metadata as AdvisorMessageMeta).streaming)
  ))?.metadata.streamStatus as string | undefined;
  const stageBlockReason = stagePack?.status.toUpperCase() === "BLOCKED"
    ? debatePackBlockReason(stagePack)
    : null;
  const stageStatus = streamingStatus ?? (stageBlockReason ? `Battle 暂时受阻：${stageBlockReason}` : undefined);

  const send = async (text: string, options: { forceDebate?: boolean; debateRole?: DebateRole } = {}) => {
    if (!user || !text.trim() || sending) return;
    if (options.forceDebate || advisorMode === "debate") {
      await sendDebate(
        text,
        resolveDebateSendRole(debateUserRole, options.debateRole),
        options.forceDebate ?? false,
      );
      return;
    }
    const relatedRecommendation = [...messages].reverse().find((message) => {
      const recommendationId = (message.metadata as { recommendationId?: unknown } | undefined)?.recommendationId;
      return message.role === "advisor" && typeof recommendationId === "string";
    })?.metadata as { recommendationId?: string } | undefined;
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
    const streamMessageId = `advisor-stream-${Date.now()}`;
    setMessages((m) => [
      ...m,
      {
        id: streamMessageId,
        role: "advisor",
        content: "",
        metadata: { streaming: true, streamStatus: "正在创建对话", thinkingSteps: [{ key: "status", title: "顾问", content: "正在创建对话" }] },
        createdAt: new Date().toISOString(),
        sessionId: currentSessionId,
      },
    ]);
    try {
      const { reply, profileUpdate, trace, sessionId: returnedSid, recommendationId, artifact, clarificationId, debateSuggestion } = await sendAdvisorMessageStream(
        text.trim(),
        currentSessionId,
        outputMode,
        {
          onSessionId: (sessionId) => {
            if (sessionId !== currentSessionId) setActiveSessionId(sessionId);
            setMessages((items) => items.map((item) => item.id === optimistic.id || item.id === streamMessageId ? { ...item, sessionId } : item));
          },
          onProgress: (status) => {
            setMessages((items) => items.map((item) => item.id === streamMessageId ? {
              ...item,
              content: item.content || "顾问正在连接专业 Agent…",
              metadata: { ...item.metadata, streaming: true, streamStatus: status },
            } : item));
          },
          onThinking: (step) => {
            setMessages((items) => items.map((item) => {
              if (item.id !== streamMessageId) return item;
              const metadata = item.metadata as { thinkingSteps?: unknown };
              const existing = Array.isArray(metadata.thinkingSteps)
                ? metadata.thinkingSteps.filter((value): value is { key: string; title: string; content: string } => (
                  Boolean(value) && typeof value === "object" && typeof (value as { key?: unknown }).key === "string"
                  && typeof (value as { title?: unknown }).title === "string" && typeof (value as { content?: unknown }).content === "string"
                ))
                : [];
              const next = existing.some((value) => value.key === step.key)
                ? existing.map((value) => value.key === step.key ? step : value)
                : [...existing, step];
              return {
                ...item,
                content: item.content || "顾问正在形成公开过程摘要…",
                metadata: { ...item.metadata, streaming: true, thinkingSteps: next, streamStatus: `${step.title}${step.content ? `：${step.content}` : ""}` },
              };
            }));
          },
          onDelta: (delta) => {
            setMessages((items) => items.map((item) => item.id === streamMessageId ? {
              ...item,
              content: `${item.content === "顾问正在连接专业 Agent…" || item.content === "顾问正在形成公开过程摘要…" ? "" : item.content}${delta}`,
              metadata: { ...item.metadata, streaming: true, streamStatus: "正在流式输出最终答复" },
            } : item));
          },
        },
      );
      const meta: Record<string, unknown> = {};
      if (profileUpdate) meta.profileUpdate = profileUpdate;
      if (trace) meta.trace = trace;
      if (recommendationId) meta.recommendationId = recommendationId;
      if (artifact) meta.artifact = artifact;
      if (clarificationId) meta.clarificationId = clarificationId;
      if (debateSuggestion) meta.debateSuggestion = debateSuggestion;
      setMessages((m) => m.map((item) => item.id === streamMessageId ? {
          ...item,
          id: `advisor-${Date.now()}`,
          role: "advisor",
          content: reply,
          metadata: meta,
          createdAt: new Date().toISOString(),
          sessionId: returnedSid ?? currentSessionId,
        } : item));
      if (profileUpdate) {
        toast.success("已更新你的财务档案");
        await refreshProfile();
      }
      if (relatedRecommendation?.recommendationId) {
        void recordRecommendationDecision(user.id, relatedRecommendation.recommendationId, "FOLLOW_UP", { reason: text.trim() }).catch(() => undefined);
      }
      void refreshSessions();
    } catch (err: any) {
      toast.error(err?.message ?? "顾问 Agent 暂时无响应");
      setMessages((m) => m.filter((x) => x.id !== optimistic.id && x.id !== streamMessageId));
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

  const startBattleFromSuggestion = (suggestion: DebateSuggestion) => {
    if (sending) return;
    const setup = suggestedBattleDraft(suggestion as DebateSuggestionWithTarget, debateUserRole);
    switchAdvisorMode("debate");
    setActiveDebateSessionId(null);
    setPendingDebateContext({ motion: setup.motion, targetSymbol: setup.targetSymbol });
    setDraft(setup.motion);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleToolAction = (tool: (typeof ACTION_TOOLS)[number] | (typeof PLUS_UPLOAD_TOOLS)[number]) => {
    setToolboxOpen(false);
    if ("upload" in tool && tool.upload) {
      setPendingUploadPrompt(tool.prompt ?? null);
      fileInputRef.current?.click();
      return;
    }
    if (tool.prompt) {
      setDraft((current) => current.trim() ? current : tool.prompt);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  const currentAdvisorMode = ADVISOR_MODES.find((mode) => mode.value === advisorMode) ?? ADVISOR_MODES[0];

  const emptyChatState = messages.length === 0 && !loadingHistory && advisorMode !== "debate";
  const composerDraft = draft;
  const composerSending = sending;
  const setComposerDraft = setDraft;
  const handleComposerSend = handleSend;

  return (
    <div className={cn(
      "advisor-workbench relative flex w-full gap-0 border-y border-border bg-card",
      advisorMode === "debate"
        ? "advisor-workbench-debate h-full min-h-0 overflow-hidden"
        : "advisor-workbench-normal h-auto min-h-[calc(100dvh-8rem)] overflow-visible md:h-full md:min-h-[640px] md:overflow-hidden",
      debateTransitioning && "advisor-workbench-transitioning",
    )}>
      {debateTransitioning ? (
        <div className="advisor-mode-transition" role="status" aria-live="polite">
          <div className="advisor-mode-transition-mark">
            <Swords className="size-5" />
          </div>
          <strong>{debateTransitionTarget === "debate" ? "正在进入辩论模式" : "正在返回普通模式"}</strong>
          <span>{debateTransitionTarget === "debate" ? "准备圆桌、角色和 Battle 记录" : "恢复普通顾问对话"}</span>
        </div>
      ) : null}

      {advisorMode === "debate" ? (
        <DebateHistoryRail
          entries={debateHistory}
          motion={stageMotion}
          status={stageStatus}
          onNewDebate={handleNewDebate}
        />
      ) : (
      <aside className="hidden w-[302px] shrink-0 flex-col border-r border-neutral-200 bg-[#f7f7f7] text-neutral-950 md:flex">
        <div className="flex items-center justify-between px-3 pb-4 pt-3">
          <button
            onClick={handleNewSession}
            className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-2xl px-3 text-left text-[15px] font-medium transition-colors hover:bg-neutral-200/80"
          >
            <MessageSquarePlus className="size-5 shrink-0" />
            <span className="truncate">新对话</span>
          </button>
        </div>
        <div className="px-4 pb-4">
          <label className="flex h-11 items-center gap-2 rounded-2xl bg-neutral-200/70 px-3 text-neutral-500 transition-colors focus-within:bg-white focus-within:ring-2 focus-within:ring-neutral-300">
            <Search className="size-4 shrink-0" />
            <input
              value={sessionSearch}
              onChange={(event) => setSessionSearch(event.target.value)}
              placeholder="搜索会话"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-neutral-950 outline-none placeholder:text-neutral-500"
            />
            {sessionSearch ? (
              <button
                type="button"
                onClick={() => setSessionSearch("")}
                className="grid size-6 shrink-0 place-items-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-950"
                aria-label="清空搜索"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </label>
        </div>
        <div className="px-4 pb-2 text-[17px] font-semibold text-neutral-950">
          最近
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {loadingSessions ? (
            <p className="px-3 py-2 text-sm text-neutral-500">加载中…</p>
          ) : sessions.length === 0 ? (
            <p className="px-3 py-4 text-sm leading-6 text-neutral-500">还没有历史会话。开始第一条消息，就会记入档案。</p>
          ) : visibleSessions.length === 0 ? (
            <p className="px-3 py-4 text-sm leading-6 text-neutral-500">没有找到匹配的会话。</p>
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
      )}

      <section className={cn(
        "flex min-w-0 flex-1 flex-col md:min-h-0",
        advisorMode === "debate" && "advisor-debate-panel",
      )}>
        <header className="flex flex-col items-start justify-between gap-2 border-b border-border px-3 py-3 sm:flex-row sm:items-center sm:px-6">
          <div className="min-w-0">
            <p className="line-clamp-1 text-sm font-medium">
              {advisorMode === "debate" ? `多空 Battle · ${stageMotion || "新辩题"}` : activeSession?.title ?? "新对话"}
            </p>
          </div>
          {advisorMode === "debate" ? <span className="debate-header-status">{stageStatus || "用户可随时加入辩论"}</span> : null}
        </header>

        <div
          ref={listRef}
          className={advisorMode === "debate"
            ? "advisor-debate-viewport"
            : "flex-none overflow-visible px-3 py-6 sm:px-6 md:min-h-0 md:flex-1 md:overflow-y-auto"}
        >
          {loadingHistory ? (
            <div className="grid min-h-[360px] place-items-center text-sm text-muted-foreground md:h-full md:min-h-0">加载对话…</div>
          ) : emptyChatState ? (
            <div className="mx-auto flex min-h-[360px] max-w-2xl flex-col items-center justify-center text-center md:h-full md:min-h-0">
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
          ) : advisorMode === "debate" ? (
            <>
              <div className="debate-history-mobile md:hidden">
                <DebateHistoryRail
                  entries={debateHistory}
                  motion={stageMotion}
                  status={stageStatus}
                  onNewDebate={handleNewDebate}
                  mobile
                />
              </div>
              <DebateCharacterStage
                activeRole={debateActivity?.role ?? null}
                motion={stageMotion}
                status={stageStatus}
                userMessage={stageUser}
                bullMessage={stageBull}
                bearMessage={stageBear}
                judgeMessage={stageJudge}
              />
            </>
          ) : (
            <>
              <ul className="flex w-full max-w-none flex-col gap-5">
              {messages.map((msg) => {
                const meta = (msg.metadata ?? {}) as AdvisorMessageMeta;
                return (
                  <li key={msg.id} className={cn("flex gap-3", msg.role === "user" ? "justify-end" : "justify-start")}>
                    {msg.role !== "user" && (
                      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        顾问
                      </div>
                    )}
                    <div className={cn("min-w-0", msg.role === "user" ? "max-w-[78%]" : "max-w-[78%] flex-1")}>
                      <div
                        className={cn(
                          "inline-block whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6",
                          msg.role === "user"
                            ? "inline-block bg-neutral-950 text-white"
                            : "bg-muted text-foreground",
                        )}
                      >
                        {msg.content}
                        {msg.role === "advisor" && meta.profileUpdate ? (
                          <div className="mt-3 rounded border border-destructive/30 bg-card px-3 py-2 text-[11px] text-destructive">
                            ✓ 已把这段信息写入你的财务档案
                          </div>
                        ) : null}
                        {msg.role === "advisor" && meta.streaming ? (
                          <div className="mt-3 rounded-md border border-blue-200 bg-blue-50/70 px-3 py-2 text-[11px] text-blue-900">
                            <div className="flex items-center gap-2 font-medium">
                              <span className="size-1.5 rounded-full bg-blue-500 animate-pulse" />
                              <span>{meta.streamStatus ?? "顾问 Agent 正在处理"}</span>
                            </div>
                            {Array.isArray(meta.thinkingSteps) && meta.thinkingSteps.length > 0 ? (
                              <ul className="mt-2 space-y-1 text-blue-800/90">
                                {meta.thinkingSteps.map((step, index) => (
                                  <li key={`${step.key}-${index}`} className="flex gap-1.5">
                                    <span className="mt-[0.55em] size-1 shrink-0 rounded-full bg-blue-500/70" />
                                    <span>{step.title}{step.content ? `：${step.content}` : ""}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      {msg.role === "advisor" && !meta.streaming && msg.content.trim() ? (
                        <div className="mt-2 flex flex-wrap items-center gap-4">
                          {meta.recommendationId ? (
                            <button
                              type="button"
                              onClick={() => navigate(`/recommendations/${meta.recommendationId}`)}
                              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:text-primary/75"
                            >
                              <FileText className="size-3.5" /> 查看建议卡
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => {
                              saveInjectiveProofDraft({ content: msg.content, sourceId: msg.id, sourceLabel: "Advisor AI 回答" });
                              navigate("/injective");
                            }}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-cyan-700 transition-colors hover:text-cyan-500"
                          >
                            <Fingerprint className="size-3.5" /> 存入 Injective 证据链
                          </button>
                        </div>
                      ) : null}
                      {msg.role === "advisor" && meta.trace ? <AdvisorTrace trace={meta.trace} /> : null}
                      {msg.role === "advisor" && meta.debateSuggestion?.recommended ? (
                        <DebateSuggestionCard suggestion={meta.debateSuggestion} onStart={startBattleFromSuggestion} />
                      ) : null}
                    </div>
                  </li>
                );
              })}
              {sending && !messages.some((message) => Boolean((message.metadata as { streaming?: unknown } | undefined)?.streaming)) && (
                <li className="flex justify-start gap-3">
                  <div className="grid size-8 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">顾问</div>
                  <div className="inline-block rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">思考中…</div>
                </li>
              )}
              </ul>
            </>
          )}
        </div>

        <div className={cn("px-3 sm:px-6", advisorMode === "debate" && "advisor-debate-composer-shell")}>
          <div
            ref={composerRef}
            className={cn(
              "mx-auto mb-16 max-w-[1100px] md:mb-6",
              advisorMode === "debate" && "advisor-debate-composer",
            )}
          >
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
                  value={composerDraft}
                  onChange={(e) => setComposerDraft(e.target.value)}
                placeholder={advisorMode === "debate" ? "向多方、空方或裁判提问…" : "发消息…"}
                rows={2}
                className="w-full min-h-[52px] resize-none border-0 bg-transparent px-2 py-1 text-sm text-neutral-900 tracking-wide caret-blue-600 outline-none placeholder:text-neutral-400"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleComposerSend();
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

              <div className="advisor-tool-row mt-1 flex items-center gap-2 px-1 pb-0.5">
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
                        setComposerDraft((current) => current.trim() ? current : pendingUploadPrompt);
                      }
                      toast.info(`已选择文件：${f.name}`);
                    }
                    setPendingUploadPrompt(null);
                    e.target.value = "";
                  }}
                />
                <div className="advisor-actions-strip flex min-w-0 flex-1 items-center gap-1.5">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setToolboxOpen(false);
                        }}
                        className="flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-100"
                        aria-label="模式选择"
                      >
                        <Sparkles className="size-4" />
                        <span>{currentAdvisorMode.label}</span>
                        <ChevronDown className="size-3.5 text-neutral-500" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      side="top"
                      sideOffset={10}
                      className="w-[168px] rounded-2xl border-neutral-200 bg-white p-1.5 text-neutral-950 shadow-[0_18px_48px_rgba(15,23,42,0.16)]"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      {ADVISOR_MODES.map((mode) => (
                        <DropdownMenuItem
                          key={mode.value}
                          onSelect={() => {
                            switchAdvisorMode(mode.value);
                          }}
                          className="flex h-10 cursor-pointer items-center justify-between rounded-xl px-3 text-sm text-neutral-950 focus:bg-neutral-100 focus:text-neutral-950"
                        >
                          <span>{mode.label}</span>
                          {advisorMode === mode.value ? <Check className="size-4 text-blue-600" /> : null}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {advisorMode === "debate" ? (
                    <div className="flex shrink-0 items-center rounded-full bg-neutral-100 p-0.5">
                      {DEBATE_ROLES.map((role) => {
                        const Icon = role.icon;
                        const active = debateUserRole === role.value;
                        return (
                          <button
                            key={role.value}
                            type="button"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              setDebateUserRole(role.value);
                            }}
                            className={cn("flex h-9 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors", active ? "bg-white text-blue-700 shadow-sm" : "text-neutral-600 hover:text-neutral-950")}
                          >
                            <Icon className="size-3.5" />
                            <span>{role.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
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
                    handleComposerSend();
                  }}
                  disabled={composerSending || (!composerDraft.trim() && !attachment)}
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

const DebateSuggestionCard = ({ suggestion, onStart }: { suggestion: DebateSuggestion; onStart: (suggestion: DebateSuggestion) => void }) => (
  <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/70 p-3 text-xs text-blue-950">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-semibold">
          <Swords className="size-4" />
          <span>这题适合多空 Battle</span>
        </div>
        <p className="mt-1 leading-5 text-blue-900/80">{suggestion.reason}</p>
      </div>
      <button
        type="button"
        onClick={() => onStart(suggestion)}
        className="shrink-0 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
      >
        开启辩论
      </button>
    </div>
  </div>
);

const DebateHistoryRail = ({
  entries,
  motion,
  status,
  onNewDebate,
  mobile = false,
}: {
  entries: DebateHistoryEntry[];
  motion: string | null;
  status?: string;
  onNewDebate: () => void;
  mobile?: boolean;
}) => (
  <aside className={cn("debate-history-rail", mobile && "debate-history-rail-mobile")}>
    <div className="debate-history-rail-header">
      <div className="flex min-w-0 items-center gap-2">
        <Swords className="size-5 shrink-0 text-blue-700" />
        <div className="min-w-0">
          <span className="debate-history-rail-kicker">Battle Room</span>
          <h2>辩论记录</h2>
        </div>
      </div>
      <button type="button" onClick={onNewDebate} aria-label="新建辩论" title="新建辩论">
        <MessageSquarePlus className="size-4" />
      </button>
    </div>
    <div className="debate-history-rail-motion">
      <span>本轮辩题</span>
      <strong>{motion || "等待用户提出问题"}</strong>
      <small>{status || "用户可以随时加入 Battle"}</small>
    </div>
    <div className="debate-history-rail-list">
      {entries.length ? entries.map((entry, index) => (
        <article className={cn("debate-history-entry", `debate-history-entry-${entry.role}`)} key={entry.id}>
          <div className="debate-history-entry-meta">
            <span>{entry.label}</span>
            <small>{entry.roundLabel || `0${index + 1}`}</small>
          </div>
          <p>{entry.text}</p>
        </article>
      )) : (
        <div className="debate-history-empty">
          <span>01</span>
          <p>你的问题会先进入记录，随后由看多、看空和裁判依次回应。</p>
        </div>
      )}
    </div>
  </aside>
);

function latestDebateTurn(pack: DebatePack, speaker: "bull" | "bear") {
  return [...pack.turns].reverse().find((turn) => turn.speaker === speaker);
}

export function debateHistoryEntries(messages: OnboardingMessage[]): DebateHistoryEntry[] {
  const entries: DebateHistoryEntry[] = [];
  for (const message of messages) {
    if (message.role === "user" && isDebateUserMessage(message)) {
      entries.push({
        id: `user-${message.id}`,
        role: "user",
        label: "你的问题",
        text: message.content,
        roundLabel: roundLabel(message.metadata.roundIndex),
      });
      continue;
    }
    if (message.role !== "advisor") continue;
    const metadata = message.metadata as AdvisorMessageMeta & { debateSessionId?: unknown; roundIndex?: unknown };
    const pack = isDebatePack(metadata.debatePack) ? metadata.debatePack : null;
    if (!pack) continue;
    const roundLabelText = roundLabel(metadata.roundIndex);
    const turns = pack.turns.filter((turn) => turn.speaker === "evidence" || turn.speaker === "bull" || turn.speaker === "bear");
    for (const turn of turns) {
      if (turn.speaker !== "evidence" && turn.speaker !== "bull" && turn.speaker !== "bear") continue;
      entries.push({
        id: `${message.id}-${turn.id}`,
        role: turn.speaker === "evidence" ? "evidence" : turn.speaker,
        label: turn.speaker === "evidence" ? "共同证据" : turn.speaker === "bull" ? "看多 agent" : "看空 agent",
        text: turn.publicSummary || turn.content,
        roundLabel: roundLabelText,
      });
    }
    const judgement = pack.judgements.at(-1);
    if (judgement) {
      entries.push({
        id: `${message.id}-judge-${judgement.id}`,
        role: "judge",
        label: "主持顾问 / 裁判",
        text: judgement.whyNotFinal,
        roundLabel: roundLabelText,
      });
    } else if (pack.status.toUpperCase() === "BLOCKED") {
      entries.push({
        id: `${message.id}-blocked`,
        role: "judge",
        label: "主持顾问 / 状态",
        text: debatePackBlockReason(pack),
        roundLabel: roundLabelText,
      });
    }
  }
  return entries.slice(-18);
}

function latestDebateUserMessage(messages: OnboardingMessage[]): OnboardingMessage | null {
  return [...messages].reverse().find((message) => message.role === "user" && isDebateUserMessage(message)) ?? null;
}

function roundLabel(value: unknown): string | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? `第 ${value} 轮` : undefined;
}

function isDebateUserMessage(message: OnboardingMessage): boolean {
  return message.metadata.outputMode === "BATTLE"
    || typeof message.metadata.debateRole === "string"
    || typeof message.metadata.debateSessionId === "string";
}

function debatePackBlockReason(pack: DebatePack): string {
  const failure = pack.agentTrace
    .map((run) => isRecord(run.failure) ? run.failure.message : null)
    .find((message): message is string => typeof message === "string" && message.trim().length > 0);
  if (!failure) return "模型服务暂时不可用，未生成多空双方观点。";
  if (/token|api[\s_-]*key|invalid credential|unauthorized/iu.test(failure)) {
    return "模型服务配置不可用，未生成多空双方观点。";
  }
  return "辩论 Agent 调用未完成，未生成多空双方观点。";
}

function latestDebatePackFromMessages(messages: OnboardingMessage[]): DebatePack | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== "advisor") continue;
    const pack = message.metadata.debatePack;
    if (isDebatePack(pack)) return pack;
  }
  return null;
}

function isDebatePack(value: unknown): value is DebatePack {
  return isRecord(value)
    && typeof value.debateSessionId === "string"
    && typeof value.motion === "string"
    && Array.isArray(value.turns)
    && Array.isArray(value.judgements);
}

export async function attachDebatePacks(
  messages: OnboardingMessage[],
  loader: (debateSessionId: string) => Promise<DebatePack> = loadDebatePack,
): Promise<OnboardingMessage[]> {
  const debateSessionIds = Array.from(new Set(messages.flatMap((message) => {
    const value = message.metadata.debateSessionId;
    return typeof value === "string" && value ? [value] : [];
  })));
  const loaded = await Promise.all(debateSessionIds.map(async (debateSessionId) => {
    try {
      return [debateSessionId, await loader(debateSessionId)] as const;
    } catch {
      return null;
    }
  }));
  const packs = new Map(
    loaded.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  );

  return messages.map((message) => {
    if (message.role !== "advisor") return message;
    const debateSessionId = message.metadata.debateSessionId;
    const pack = typeof debateSessionId === "string" ? packs.get(debateSessionId) : undefined;
    const roundId = debateRoundIdFromMetadata(message.metadata);
    return pack
      ? {
          ...message,
          metadata: {
            ...message.metadata,
            debatePack: roundId ? selectDebateRoundPack(pack, roundId, message.metadata) : pack,
          },
        }
      : message;
  });
}

export function resolveDebateSendRole(
  selectedRole: DebateRole,
  explicitRole?: DebateRole,
): DebateRole {
  return explicitRole ?? selectedRole;
}

export function restoredDebateSessionId(messages: OnboardingMessage[]): string | null {
  return restoredDebateState(messages)?.debateSessionId ?? null;
}

export function restoredDebateState(messages: OnboardingMessage[]): {
  debateSessionId: string;
  userRole: DebateRole;
  roundIndex: number | null;
} | null {
  const reversed = [...messages].reverse();
  const debateSessionId = reversed.map((message) => message.metadata?.debateSessionId)
    .find((value): value is string => typeof value === "string" && Boolean(value));
  if (!debateSessionId) return null;

  const role = reversed
    .filter((message) => message.metadata?.debateSessionId === debateSessionId)
    .map((message) => message.metadata?.userRole ?? message.metadata?.debateRole)
    .find(isDebateRole);
  const roundIndex = reversed
    .filter((message) => message.metadata?.debateSessionId === debateSessionId)
    .map((message) => message.metadata?.roundIndex)
    .find((value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0);
  return { debateSessionId, userRole: role ?? "neutral", roundIndex: roundIndex ?? null };
}

export function suggestedBattleDraft(
  suggestion: DebateSuggestionWithTarget,
  userRole: DebateRole,
): { motion: string; targetSymbol: string | null; userRole: DebateRole } {
  return {
    motion: suggestion.motion,
    targetSymbol: typeof suggestion.targetSymbol === "string" && suggestion.targetSymbol.trim()
      ? suggestion.targetSymbol.trim()
      : null,
    userRole,
  };
}

export function selectDebateRoundPack(
  pack: DebatePack,
  roundId: string,
  metadata: Record<string, unknown> = {},
): DebatePack {
  const targetRound = pack.rounds.find((round) => round.id === roundId);
  const motion = typeof metadata.debateMotion === "string" && metadata.debateMotion.trim()
    ? metadata.debateMotion
    : pack.motion;
  const status = typeof targetRound?.status === "string" ? targetRound.status : pack.status;
  return {
    ...pack,
    motion,
    status,
    rounds: pack.rounds.filter((round) => round.id === roundId),
    turns: pack.turns.filter((turn) => turn.roundId === roundId),
    judgements: pack.judgements.filter((judgement) => judgement.roundId === roundId),
    events: pack.events.filter((event) => {
      const payload = event.payload;
      return isRecord(payload) && payload.roundId === roundId;
    }),
    evidence: [],
    publication: (metadata.publication as DebatePack["publication"] | undefined) ?? null,
  };
}

export function debateEvidenceFacts(pack: DebatePack | undefined): string[] {
  if (!pack) return [];
  const evidenceTurn = [...pack.turns].reverse().find((turn) => turn.speaker === "evidence");
  const board = isRecord(evidenceTurn?.structuredPayload.board) ? evidenceTurn.structuredPayload.board : null;
  const facts = board
    ? ["profileFacts", "portfolioFacts", "marketFacts"].flatMap((key) => (
        Array.isArray(board[key]) ? board[key] : []
      ))
    : [];
  const normalized = facts.flatMap((fact) => {
    if (typeof fact === "string" && fact.trim()) return [fact.trim()];
    if (!isRecord(fact)) return [];
    for (const key of ["statement", "summary", "title"] as const) {
      const value = fact[key];
      if (typeof value === "string" && value.trim()) return [value.trim()];
    }
    return [];
  });
  if (normalized.length) return normalized.slice(0, 3);
  return pack.evidence.flatMap((item) => {
    for (const key of ["summary", "statement", "title"] as const) {
      const value = item[key];
      if (typeof value === "string" && value.trim()) return [value.trim()];
    }
    return [];
  }).slice(0, 3);
}

function latestDebateRoundId(pack: DebatePack): string | null {
  const judgementRoundId = pack.judgements.at(-1)?.roundId;
  if (judgementRoundId) return judgementRoundId;
  const roundId = pack.rounds.at(-1)?.id;
  return typeof roundId === "string" && roundId ? roundId : null;
}

function debateRoundIdFromMetadata(metadata: Record<string, unknown>): string | null {
  const value = metadata.roundId ?? metadata.debateRoundId;
  return typeof value === "string" && value ? value : null;
}

function isDebateRole(value: unknown): value is DebateRole {
  return value === "neutral" || value === "bull" || value === "bear";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default AdvisorPage;
