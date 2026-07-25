/* eslint-disable max-lines */
import { apiGet, apiPost, FrontendApiError } from "@/features/frontend-migration/api";

export type DebateRole = "neutral" | "bull" | "bear";
type DebateSpeaker = "user" | "evidence" | "bull" | "bear" | "judge" | "orchestrator";

export type DebateTurn = {
  id: string;
  roundId: string;
  speaker: DebateSpeaker;
  stance: "bull" | "bear" | "neutral";
  turnType: string;
  content: string;
  publicSummary: string;
  structuredPayload: Record<string, unknown>;
};

export type DebateJudgement = {
  id: string;
  roundId: string;
  userClaim: string;
  bullStrongestPoint: string;
  bearStrongestPoint: string;
  keyDisagreement: string;
  responseQuality: { bull?: string; bear?: string };
  evidenceTilt: string;
  confidence: number;
  whyNotFinal: string;
  suggestedNextPrompts: string[];
  complianceNote: string;
};

export type DebatePublication = {
  analysisId: string;
  status: "ACTIVE" | "DEGRADED" | "BLOCKED";
  direction: "BUY" | "SELL" | "HOLD" | "ANALYZE";
  action: "WATCH" | "TRIAL_BUY" | "SCALE_IN" | "HOLD" | "STOP_ADDING" | "SCALE_OUT" | "EXIT";
  answer: string;
  recommendationId: string | null;
  missingInformation: string[];
  provider: "CHIEF_ADVISOR" | "DETERMINISTIC_FALLBACK";
};

export type DebatePack = {
  debateSessionId: string;
  motion: string;
  status: string;
  rounds: Array<Record<string, unknown>>;
  turns: DebateTurn[];
  judgements: DebateJudgement[];
  agentTrace: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  publication: DebatePublication | null;
  disclaimer: string;
};

export type DebateReply = {
  reply: string;
  sessionId: string;
  debateSessionId: string;
  pack: DebatePack;
};

export type DebateActivityRole = "moderator" | "user" | "bull" | "bear";
export type DebateStreamActivity = {
  role: DebateActivityRole;
  phase: "started" | "completed" | "blocked";
  eventType: string;
  publicSummary?: string;
  roundId?: string;
  turnType?: string;
};

export type DebateStreamObserver = {
  onProgress?: (message: string) => void;
  onActivity?: (activity: DebateStreamActivity) => void;
};

type DebateApiResult = {
  debateSessionId: string;
  roundIndex?: number;
  analysis?: { streamUrl?: string };
};

export async function startDebateMessage(
  message: string,
  sessionId: string | null,
  userRole: DebateRole,
  observer: DebateStreamObserver = {},
  trustedTargetSymbol?: string | null,
): Promise<DebateReply> {
  const conversationId = await ensureConversation(sessionId, message);
  const targetSymbol = await resolveDebateTargetSymbol(message, trustedTargetSymbol);
  observer.onProgress?.("正在开启多空 Battle");
  const result = await apiPost<DebateApiResult>("/api/v1/debates", {
    conversationId,
    message,
    initialUserRole: userRole,
    targetSymbol: targetSymbol ?? undefined,
  });
  return finishDebate(conversationId, result, observer);
}

export async function continueDebateMessage(debateSessionId: string, content: string, userRole: DebateRole, observer: DebateStreamObserver = {}): Promise<DebateReply> {
  observer.onProgress?.("正在推进下一轮 Battle");
  const result = await apiPost<DebateApiResult>(`/api/v1/debates/${debateSessionId}/turns`, { content, userRole });
  const pack = await finishDebatePack(result.debateSessionId, result.analysis?.streamUrl, observer, result.roundIndex);
  return { reply: formatDebateReply(pack), sessionId: "", debateSessionId: result.debateSessionId, pack };
}

export async function resumeDebateMessage(
  debateSessionId: string,
  roundIndex: number,
  observer: DebateStreamObserver = {},
): Promise<DebatePack> {
  return finishDebatePack(
    debateSessionId,
    `/api/v1/debates/${debateSessionId}/events`,
    observer,
    roundIndex,
  );
}

export async function loadDebatePack(debateSessionId: string): Promise<DebatePack> {
  return apiGet<DebatePack>(`/api/v1/debates/${debateSessionId}/evidence-pack`);
}

export function extractDebateTargetSymbol(message: string): string | null {
  return message.toUpperCase().match(/\b(?:\d{6}(?:\.(?:SH|SZ|OF))?|\d{5}\.HK|[A-Z]{1,10}(?:\.(?:US|HK))?)\b/u)?.[0] ?? null;
}

export function selectDebateTargetSymbol(trustedTargetSymbol: string | null | undefined, message: string): string | null {
  const trusted = trustedTargetSymbol?.trim();
  return trusted || extractDebateTargetSymbol(message);
}

export function formatDebateReply(pack: DebatePack): string {
  const judgement = pack.judgements.at(-1);
  const bull = latestTurn(pack, "bull")?.publicSummary ?? judgement?.bullStrongestPoint ?? "多方观点仍需补充。";
  const bear = latestTurn(pack, "bear")?.publicSummary ?? judgement?.bearStrongestPoint ?? "空方观点仍需补充。";
  const judge = judgement?.whyNotFinal ?? "裁判尚未给出总结。";
  return [
    `多空 Battle：${pack.motion}`,
    `多方：${bull}`,
    `空方：${bear}`,
    `裁判：${judge}`,
    ...(pack.publication ? [`Chief Advisor 发布门：${pack.publication.answer}`] : []),
  ].join("\n");
}

async function finishDebate(conversationId: string, result: DebateApiResult, observer: DebateStreamObserver): Promise<DebateReply> {
  const pack = await finishDebatePack(result.debateSessionId, result.analysis?.streamUrl, observer, result.roundIndex);
  return { reply: formatDebateReply(pack), sessionId: conversationId, debateSessionId: result.debateSessionId, pack };
}

async function finishDebatePack(
  debateSessionId: string,
  streamUrl: string | undefined,
  observer: DebateStreamObserver,
  expectedRoundIndex?: number,
): Promise<DebatePack> {
  if (streamUrl) await watchDebateStream(streamUrl, observer, expectedRoundIndex);
  const pack = await waitForSettledDebatePack(debateSessionId, expectedRoundIndex);
  if (!isDebatePackSettled(pack, expectedRoundIndex)) throw new Error("Battle 尚未完成，请稍后重试");
  observer.onProgress?.("Battle 裁判总结已完成");
  return pack;
}

function watchDebateStream(streamUrl: string, observer: DebateStreamObserver, expectedRoundIndex?: number): Promise<void> {
  if (typeof EventSource === "undefined") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const source = new EventSource(streamUrl);
    const timeout = window.setTimeout(() => { source.close(); reject(new Error("Battle 事件流超时")); }, 600_000);
    const finish = () => { window.clearTimeout(timeout); source.close(); resolve(); };
    for (const type of [
      "debate.started",
      "debate.round.started",
      "debate.evidence.started",
      "debate.evidence.completed",
      "debate.turn.completed",
      "debate.agent.started",
      "debate.agent.completed",
      "debate.judge.started",
      "debate.judge.completed",
      "debate.round.completed",
      "debate.blocked",
    ]) {
      source.addEventListener(type, (event) => {
        const eventPayload = parsePayload(event);
        const activity = debateStreamActivity(type, eventPayload);
        if (activity) observer.onActivity?.(activity);
        observer.onProgress?.(debateStreamLabel(type, eventPayload));
        if (shouldFinishDebateStream(type, eventPayload, expectedRoundIndex)) finish();
      });
    }
    source.onerror = () => {
      observer.onProgress?.("Battle 事件流中断，正在自动重连");
    };
  });
}

async function ensureConversation(sessionId: string | null, title: string): Promise<string> {
  if (!sessionId) return (await apiPost<{ id: string }>("/api/v1/conversations", { title: title.slice(0, 60) })).id;
  try {
    await apiGet(`/api/v1/conversations/${sessionId}`);
    return sessionId;
  } catch (error) {
    if (!(error instanceof FrontendApiError) || error.status !== 404) throw error;
    return (await apiPost<{ id: string }>("/api/v1/conversations", { title: title.slice(0, 60) })).id;
  }
}

async function resolveDebateTargetSymbol(message: string, trustedTargetSymbol?: string | null): Promise<string | null> {
  const trusted = trustedTargetSymbol?.trim();
  if (trusted) return trusted;
  const candidate = selectDebateTargetSymbol(null, message);
  if (!candidate || candidate.includes(".")) return candidate;
  const result = await apiGet<{ items: Array<{ symbol?: string }> }>(`/api/v1/instruments/search?q=${encodeURIComponent(candidate)}&limit=10`).catch(() => ({ items: [] }));
  return result.items.find((item) => item.symbol?.toUpperCase() === candidate || item.symbol?.toUpperCase().startsWith(`${candidate}.`))?.symbol ?? null;
}

async function waitForSettledDebatePack(debateSessionId: string, expectedRoundIndex?: number): Promise<DebatePack> {
  let pack = await loadDebatePack(debateSessionId);
  for (let attempt = 0; attempt < 20 && !isDebatePackSettled(pack, expectedRoundIndex); attempt += 1) {
    await delay(500);
    pack = await loadDebatePack(debateSessionId);
  }
  return pack;
}

export function isDebatePackSettled(pack: DebatePack, expectedRoundIndex?: number): boolean {
  const sessionStatus = pack.status.toUpperCase();
  if (["BLOCKED", "FAILED", "CANCELLED"].includes(sessionStatus)) return true;
  const targetRound = expectedRoundIndex === undefined
    ? pack.rounds.at(-1)
    : pack.rounds.find((round) => Number(round.roundIndex) === expectedRoundIndex);
  const roundStatus = typeof targetRound?.status === "string" ? targetRound.status.toUpperCase() : "";
  if (["BLOCKED", "FAILED", "CANCELLED"].includes(roundStatus)) return true;
  if (roundStatus !== "COMPLETED") return false;
  const roundId = typeof targetRound?.id === "string" ? targetRound.id : null;
  return Boolean(roundId && pack.judgements.some((judgement) => judgement.roundId === roundId));
}

export function isDebateSessionUnavailable(error: unknown): boolean {
  if (!(error instanceof FrontendApiError)) return false;
  return error.status === 404
    || error.code === "DEBATE_NOT_FOUND"
    || error.code === "DEBATE_BLOCKED"
    || error.code === "DEBATE_NOT_ACTIVE";
}

export function shouldFinishDebateStream(
  type: string,
  payload: Record<string, unknown>,
  expectedRoundIndex?: number,
): boolean {
  if (type !== "debate.round.completed" && type !== "debate.blocked") return false;
  if (expectedRoundIndex === undefined) return true;
  return Number(payload.roundIndex) === expectedRoundIndex;
}

export function debateStreamActivity(
  type: string,
  payload: Record<string, unknown>,
): DebateStreamActivity | null {
  const eventDetails = {
    publicSummary: typeof payload.publicSummary === "string" ? payload.publicSummary : undefined,
    roundId: typeof payload.roundId === "string" ? payload.roundId : undefined,
    turnType: typeof payload.turnType === "string" ? payload.turnType : undefined,
  };
  if (type === "debate.started" || type === "debate.round.started") {
    return { role: "moderator", phase: "started", eventType: type, ...eventDetails };
  }
  if (type === "debate.evidence.started" || type === "debate.evidence.completed") {
    return { role: "moderator", phase: type.endsWith(".completed") ? "completed" : "started", eventType: type, ...eventDetails };
  }
  if (type === "debate.turn.completed" && payload.speaker === "user") {
    return { role: "user", phase: "completed", eventType: type, ...eventDetails };
  }
  if ((type === "debate.agent.started" || type === "debate.agent.completed") && (payload.speaker === "bull" || payload.speaker === "bear")) {
    return {
      role: payload.speaker,
      phase: type.endsWith(".completed") ? "completed" : "started",
      eventType: type,
      ...eventDetails,
    };
  }
  if (type === "debate.judge.started" || type === "debate.judge.completed" || type === "debate.round.completed") {
    return {
      role: "moderator",
      phase: type === "debate.round.completed" || type.endsWith(".completed") ? "completed" : "started",
      eventType: type,
      ...eventDetails,
    };
  }
  if (type === "debate.blocked") {
    return { role: "moderator", phase: "blocked", eventType: type, ...eventDetails };
  }
  return null;
}

function latestTurn(pack: DebatePack, speaker: "bull" | "bear"): DebateTurn | undefined {
  return [...pack.turns].reverse().find((turn) => turn.speaker === speaker);
}

function parsePayload(event: Event): Record<string, unknown> {
  try {
    return JSON.parse((event as MessageEvent<string>).data) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function debateStreamLabel(type: string, payload: Record<string, unknown>): string {
  const speaker = typeof payload.speaker === "string" ? payload.speaker : "";
  if (type === "debate.started") return "主持顾问正在安排本轮 Battle";
  if (type === "debate.round.started") return "主持顾问已开启新一轮";
  if (type === "debate.evidence.started") return "主持顾问正在整理共同证据";
  if (type === "debate.evidence.completed") return "共同证据板已准备好";
  if (type === "debate.turn.completed") return "你的问题已进入 Battle";
  if (type === "debate.agent.started") return speaker === "bull" ? "看多 Agent 正在思考" : speaker === "bear" ? "看空 Agent 正在思考" : "辩论 Agent 正在思考";
  if (type === "debate.agent.completed") return speaker === "bull" ? "看多 Agent 正在发言" : speaker === "bear" ? "看空 Agent 正在发言" : "辩论方正在发言";
  if (type === "debate.judge.started") return "裁判正在思考总结";
  if (type === "debate.judge.completed") return "裁判正在发言";
  if (type === "debate.round.completed") return "本轮 Battle 完成";
  return "Battle 暂时受阻";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
