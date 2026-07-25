import { apiGet, apiPatch, apiPost, FrontendApiError } from "@/features/frontend-migration/api";
import { createClientId } from "@/lib/client-id";
import type { AdvisorReply, AdvisorSessionSummary, AdvisorTrace, ConversationOutputMode, OnboardingMessage, TraceSpan } from "@/types/app/onboarding";

type AdvisorWorkflow = "CONVERSATION" | "DAILY_PORTFOLIO";

type ConversationRow = { id: string; title: string; created_at: string; updated_at: string; row_version: number; last_message_preview?: string };
type MessageRow = { id: string; role: string; content: string; metadata_json?: string; created_at: string; session_id?: string; agent_run_id?: string | null };
type StreamStarted = {
  messageId?: string;
  answer?: string | null;
  analysis?: { analysisId?: string; streamUrl?: string; status?: string };
  recommendationId?: string | null;
  artifact?: AdvisorReply["artifact"];
  clarificationId?: string | null;
};
type AdvisorStreamObserver = {
  onSessionId?: (sessionId: string) => void;
  onProgress?: (message: string) => void;
  onThinking?: (message: { key: string; title: string; content: string }) => void;
  onDelta?: (delta: string) => void;
};

const ADVISOR_STREAM_EVENTS = [
  "agent.started",
  "agent.delegated",
  "agent.completed",
  "agent.failed",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "evidence.added",
  "advisor.thinking",
  "assistant.delta",
  "compliance.completed",
  "recommendation.created",
] as const;

const mapMessage = (row: MessageRow): OnboardingMessage => ({
  id: row.id,
  role: row.role === "assistant" ? "advisor" : row.role === "system" ? "system" : "user",
  content: row.content,
  metadata: {
    ...(row.metadata_json ? JSON.parse(row.metadata_json) as Record<string, unknown> : {}),
    ...(row.agent_run_id ? { analysisId: row.agent_run_id } : {}),
  },
  createdAt: row.created_at,
  sessionId: row.session_id ?? null,
});

export async function listOnboardingMessages(_userId: string, sessionId?: string): Promise<OnboardingMessage[]> {
  void _userId;
  if (!sessionId) return [];
  const result = await apiGet<{ items: MessageRow[] }>(`/api/v1/conversations/${sessionId}/messages`);
  return Promise.all(result.items.map(async (row) => {
    const message = mapMessage(row);
    if (row.role !== "assistant" || !row.agent_run_id || message.metadata.conversationKind === "GUIDED_INTAKE") return message;
    const trace = await loadAdvisorTrace(row.agent_run_id).catch(() => null);
    return trace ? { ...message, metadata: { ...message.metadata, trace } } : message;
  }));
}

export async function listAdvisorSessions(_userId: string): Promise<AdvisorSessionSummary[]> {
  void _userId;
  const result = await apiGet<{ items: ConversationRow[] }>("/api/v1/conversations?limit=100");
  return result.items.map((row) => ({
    sessionId: row.id,
    title: row.title || "新对话",
    messageCount: row.last_message_preview ? 1 : 0,
    lastActivityAt: row.updated_at,
    firstActivityAt: row.created_at,
  }));
}

async function ensureConversation(sessionId: string | null, title: string): Promise<string> {
  if (!sessionId) {
    const created = await apiPost<ConversationRow>("/api/v1/conversations", { title: title.slice(0, 60) });
    return created.id;
  }
  try {
    await apiGet(`/api/v1/conversations/${sessionId}`);
    return sessionId;
  } catch (error) {
    if (!(error instanceof FrontendApiError) || error.status !== 404) throw error;
    const created = await apiPost<ConversationRow>("/api/v1/conversations", { title: title.slice(0, 60) });
    return created.id;
  }
}

export async function sendAdvisorMessage(message: string, sessionId: string | null, outputMode: ConversationOutputMode): Promise<AdvisorReply> {
  const activeSessionId = await ensureConversation(sessionId, message);
  const result = await apiPost<Record<string, unknown>>(`/api/v1/conversations/${activeSessionId}/messages`, {
    clientMessageId: createClientId(),
    content: message,
    outputMode,
  });
  const analysis = result.analysis as { analysisId?: string } | undefined;
  const trace = analysis?.analysisId && result.conversationKind !== "GUIDED_INTAKE"
    ? await loadAdvisorTrace(analysis.analysisId).catch(() => null)
    : null;
  return {
    reply: String(result.answer ?? "分析已完成。"),
    profileUpdate: null,
    trace,
    sessionId: activeSessionId,
    analysisId: analysis?.analysisId ?? null,
    recommendationId: typeof result.recommendationId === "string" ? result.recommendationId : null,
    artifact: result.artifact && typeof result.artifact === "object" ? result.artifact as AdvisorReply["artifact"] : null,
    clarificationId: typeof result.clarificationId === "string" ? result.clarificationId : null,
  };
}

export async function sendAdvisorMessageStream(
  message: string,
  sessionId: string | null,
  outputMode: ConversationOutputMode,
  observer: AdvisorStreamObserver = {},
  workflow: AdvisorWorkflow = "CONVERSATION",
): Promise<AdvisorReply> {
  const activeSessionId = await ensureConversation(sessionId, message);
  observer.onSessionId?.(activeSessionId);
  observer.onProgress?.("已创建对话，正在理解你的问题");
  const result = await apiPost<StreamStarted>(`/api/v1/conversations/${activeSessionId}/messages/stream`, {
    clientMessageId: createClientId(),
    content: message,
    outputMode,
    workflow,
  });
  const analysisId = result.analysis?.analysisId ?? null;
  const streamUrl = result.analysis?.streamUrl;
  if (analysisId && streamUrl && !result.answer) {
    observer.onProgress?.("顾问正在判断是否需要启动专业分析");
    await watchAdvisorStream(streamUrl, observer).catch((error) => {
      observer.onProgress?.(error instanceof Error ? error.message : "事件流中断，正在读取最终结果");
    });
  }
  const assistant = analysisId ? await waitForAssistantMessage(activeSessionId, analysisId) : null;
  const metadata = assistant?.metadata ?? {};
  const trace = analysisId && metadata.conversationKind !== "GUIDED_INTAKE"
    ? await loadAdvisorTrace(analysisId).catch(() => null)
    : null;
  return {
    reply: assistant?.content ?? String(result.answer ?? "分析已完成。"),
    profileUpdate: null,
    trace,
    sessionId: activeSessionId,
    analysisId,
    recommendationId: typeof metadata.recommendationId === "string" ? metadata.recommendationId : result.recommendationId ?? null,
    artifact: result.artifact && typeof result.artifact === "object" ? result.artifact : null,
    clarificationId: typeof result.clarificationId === "string" ? result.clarificationId : null,
  };
}

function watchAdvisorStream(streamUrl: string, observer: AdvisorStreamObserver): Promise<void> {
  if (typeof EventSource === "undefined") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const source = new EventSource(streamUrl);
    const timeout = window.setTimeout(() => {
      source.close();
      reject(new Error("顾问事件流超时，正在读取最终结果"));
    }, 600_000);
    const finish = () => {
      window.clearTimeout(timeout);
      source.close();
      resolve();
    };
    for (const type of ADVISOR_STREAM_EVENTS) {
      source.addEventListener(type, (event) => {
        const payload = parseStreamPayload(event);
        if (type === "assistant.delta") {
          const delta = typeof payload.delta === "string" ? payload.delta : "";
          if (delta) observer.onDelta?.(delta);
          return;
        }
        if (type === "advisor.thinking") {
          observer.onThinking?.(streamThinkingUpdate(payload));
          return;
        }
        observer.onProgress?.(streamLabel(type, payload));
        if (type === "agent.completed" && (!payload.agent || payload.status === "WAITING_FOR_USER" || payload.status === "BLOCKED")) finish();
        if (type === "agent.failed" && payload.code === "ADVISOR_RUN_FAILED") finish();
      });
    }
    source.onerror = () => {
      window.clearTimeout(timeout);
      source.close();
      reject(new Error("顾问事件流连接中断，正在读取最终结果"));
    };
  });
}

function parseStreamPayload(event: Event): Record<string, unknown> {
  try {
    return JSON.parse((event as MessageEvent<string>).data) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function streamLabel(type: string, payload: Record<string, unknown>): string {
  const agent = typeof payload.agent === "string" ? payload.agent : "";
  if (type === "agent.started") return "顾问 Agent 已接入，开始拆解问题";
  if (type === "agent.delegated") return agent ? `正在委派 ${agent}` : "正在委派专业子 Agent";
  if (type === "agent.completed" && agent) return `${agent} 已返回结论`;
  if (type === "agent.completed") return "顾问 Agent 已完成，正在整理回答";
  if (type === "agent.failed") return agent ? `${agent} 暂时失败，正在降级处理` : "顾问 Agent 暂时失败，正在读取结果";
  if (type === "tool.started") return "正在调用工具获取证据";
  if (type === "tool.completed") return "工具结果已返回，正在合并证据";
  if (type === "tool.failed") return "工具调用失败，正在使用可用证据降级";
  if (type === "evidence.added") return "已补充一条证据";
  if (type === "compliance.completed") return "合规检查完成，正在生成最终说明";
  if (type === "recommendation.created") return "建议卡已生成";
  return "顾问 Agent 正在处理";
}

function streamThinkingUpdate(payload: Record<string, unknown>): { key: string; title: string; content: string } {
  const title = typeof payload.title === "string" ? payload.title : "顾问正在整理过程";
  const content = typeof payload.content === "string" ? payload.content : "";
  const agent = typeof payload.agent === "string" ? payload.agent : "decision";
  return { key: agent, title, content };
}

async function waitForAssistantMessage(sessionId: string, analysisId: string): Promise<OnboardingMessage | null> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const result = await apiGet<{ items: MessageRow[] }>(`/api/v1/conversations/${sessionId}/messages`);
    const row = [...result.items].reverse().find((item) => item.role === "assistant" && item.agent_run_id === analysisId);
    if (row) return mapMessage(row);
    await delay(1_000);
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function loadAdvisorTrace(analysisId: string): Promise<AdvisorTrace> {
  const pack = await apiGet<{
    analysis: { createdAt: string; completedAt?: string | null };
    agentTrace: Array<{ id: string; parentRunId?: string | null; agent: string; status: string; inputSummary?: string | null; purpose?: string | null; summary?: string | null; modelProvider?: string | null; modelName?: string | null; startedAt: string; completedAt?: string | null; failure?: { message?: string } | null }>;
    toolCalls: Array<{ id: string; toolName: string; status: string; input?: unknown; result?: unknown; outputSummary?: string | null; startedAt?: string | null; completedAt?: string | null; error?: { message?: string } | null }>;
    skillRuns: Array<{ id: string; method: string; status: string; quality: string; outputSummary?: string | null; dataAsOf?: string | null }>;
    missingEvidence: string[];
    disclaimer: string;
  }>(`/api/v1/analyses/${analysisId}/evidence-pack?includeToolPayload=true`);
  const traceEnd = latestTimestamp([
    pack.analysis.completedAt,
    ...pack.agentTrace.map((item) => item.completedAt),
    ...pack.toolCalls.map((item) => item.completedAt),
  ]) ?? pack.analysis.completedAt ?? null;
  const spans: TraceSpan[] = [
    ...pack.agentTrace.map((item): TraceSpan => ({
      id: item.id,
      name: item.agent,
      label: item.agent,
      kind: item.modelProvider && item.modelProvider !== "deterministic" ? "llm" : "reasoning",
      tool: null,
      input: item.inputSummary ?? item.purpose ?? null,
      output: item.summary ?? item.failure?.message ?? null,
      startedAt: item.startedAt,
      durationMs: elapsed(item.startedAt, item.completedAt ?? (item.parentRunId ? null : traceEnd)),
      status: item.status === "FAILED" ? "error" : "ok",
      note: item.purpose ?? undefined,
    })),
    ...pack.toolCalls.map((item): TraceSpan => ({
      id: item.id,
      name: item.toolName,
      label: item.toolName,
      kind: "tool",
      tool: item.toolName,
      input: item.input ?? null,
      output: item.outputSummary ?? item.error?.message ?? null,
      startedAt: item.startedAt ?? pack.analysis.createdAt,
      durationMs: elapsed(item.startedAt, item.completedAt),
      status: item.status === "FAILED" ? "error" : "ok",
    })),
    ...pack.skillRuns.map((item): TraceSpan => ({
      id: item.id,
      name: item.method,
      label: `Skill · ${item.method}`,
      kind: "io",
      tool: item.method,
      input: item.dataAsOf ? { dataAsOf: item.dataAsOf } : null,
      output: { quality: item.quality, summary: item.outputSummary ?? null },
      startedAt: pack.analysis.createdAt,
      durationMs: 0,
      status: item.status === "FAILED" ? "error" : "ok",
    })),
  ];
  return {
    id: analysisId,
    startedAt: pack.analysis.createdAt,
    totalMs: elapsed(pack.analysis.createdAt, traceEnd),
    model: pack.agentTrace.find((item) => item.modelName)?.modelName ?? "Professional Advisor",
    spans,
    finalReply: [...pack.missingEvidence, pack.disclaimer].join("\n"),
  };
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  const times = values
    .map((value) => value ? new Date(value).getTime() : Number.NaN)
    .filter((value) => Number.isFinite(value));
  if (!times.length) return null;
  return new Date(Math.max(...times)).toISOString();
}

function elapsed(start?: string | null, end?: string | null): number {
  if (!start || !end) return 0;
  return Math.max(0, new Date(end).getTime() - new Date(start).getTime());
}

export async function deleteAdvisorSession(_userId: string, sessionId: string): Promise<void> {
  const current = await apiGet<ConversationRow>(`/api/v1/conversations/${sessionId}`);
  await apiPatch(`/api/v1/conversations/${sessionId}`, { status: "ARCHIVED" }, current.row_version);
}

export async function clearOnboardingConversation(userId: string): Promise<void> {
  const sessions = await listAdvisorSessions(userId);
  await Promise.all(sessions.map((session) => deleteAdvisorSession(userId, session.sessionId)));
}
