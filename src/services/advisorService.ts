import { apiGet, apiPatch, apiPost, FrontendApiError } from "@/features/frontend-migration/api";
import type { AdvisorReply, AdvisorSessionSummary, AdvisorTrace, ConversationOutputMode, OnboardingMessage, TraceSpan } from "@/types/app/onboarding";

type ConversationRow = { id: string; title: string; created_at: string; updated_at: string; row_version: number; last_message_preview?: string };
type MessageRow = { id: string; role: string; content: string; metadata_json?: string; created_at: string; session_id?: string; agent_run_id?: string | null };

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
  if (!sessionId) return [];
  const result = await apiGet<{ items: MessageRow[] }>(`/api/v1/conversations/${sessionId}/messages`);
  return Promise.all(result.items.map(async (row) => {
    const message = mapMessage(row);
    if (row.role !== "assistant" || !row.agent_run_id) return message;
    const trace = await loadAdvisorTrace(row.agent_run_id).catch(() => null);
    return trace ? { ...message, metadata: { ...message.metadata, trace } } : message;
  }));
}

export async function listAdvisorSessions(_userId: string): Promise<AdvisorSessionSummary[]> {
  const result = await apiGet<{ items: ConversationRow[] }>("/api/v1/conversations?limit=100");
  return result.items.map((row) => ({
    sessionId: row.id,
    title: row.title || "新对话",
    messageCount: row.last_message_preview ? 1 : 0,
    lastActivityAt: row.updated_at,
    firstActivityAt: row.created_at,
  }));
}

async function ensureConversation(sessionId: string, title: string): Promise<string> {
  try {
    await apiGet(`/api/v1/conversations/${sessionId}`);
    return sessionId;
  } catch (error) {
    if (!(error instanceof FrontendApiError) || error.status !== 404) throw error;
    const created = await apiPost<ConversationRow>("/api/v1/conversations", { title: title.slice(0, 60) });
    return created.id;
  }
}

export async function sendAdvisorMessage(message: string, sessionId: string, outputMode: ConversationOutputMode): Promise<AdvisorReply> {
  const activeSessionId = await ensureConversation(sessionId, message);
  const result = await apiPost<Record<string, unknown>>(`/api/v1/conversations/${activeSessionId}/messages`, {
    clientMessageId: crypto.randomUUID(),
    content: message,
    outputMode,
  });
  const analysis = result.analysis as { analysisId?: string } | undefined;
  const trace = analysis?.analysisId ? await loadAdvisorTrace(analysis.analysisId).catch(() => null) : null;
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

async function loadAdvisorTrace(analysisId: string): Promise<AdvisorTrace> {
  const pack = await apiGet<{
    analysis: { createdAt: string; completedAt?: string | null };
    agentTrace: Array<{ id: string; agent: string; status: string; purpose?: string | null; summary?: string | null; modelProvider?: string | null; modelName?: string | null; startedAt: string; completedAt?: string | null; failure?: { message?: string } | null }>;
    toolCalls: Array<{ id: string; toolName: string; status: string; outputSummary?: string | null; startedAt?: string | null; completedAt?: string | null; error?: { message?: string } | null }>;
    skillRuns: Array<{ id: string; method: string; status: string; quality: string; outputSummary?: string | null; dataAsOf?: string | null }>;
    missingEvidence: string[];
    disclaimer: string;
  }>(`/api/v1/analyses/${analysisId}/evidence-pack`);
  const spans: TraceSpan[] = [
    ...pack.agentTrace.map((item): TraceSpan => ({
      id: item.id,
      name: item.agent,
      label: item.agent,
      kind: "reasoning",
      tool: null,
      input: item.purpose ?? null,
      output: item.summary ?? item.failure?.message ?? null,
      startedAt: item.startedAt,
      durationMs: elapsed(item.startedAt, item.completedAt),
      status: item.status === "FAILED" ? "error" : "ok",
      note: item.purpose ?? undefined,
    })),
    ...pack.toolCalls.map((item): TraceSpan => ({
      id: item.id,
      name: item.toolName,
      label: item.toolName,
      kind: "tool",
      tool: item.toolName,
      input: null,
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
    totalMs: elapsed(pack.analysis.createdAt, pack.analysis.completedAt),
    model: pack.agentTrace.find((item) => item.modelName)?.modelName ?? "Professional Advisor",
    spans,
    finalReply: [...pack.missingEvidence, pack.disclaimer].join("\n"),
  };
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
