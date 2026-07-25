/* eslint-disable max-lines */
import { runDebateAdvocate, runDebateJudge, runDebateOrchestrator } from "@/mastra/agents/debate-agents";
import { runAdvisorPublicationGate, type AdvisorPublicationResult } from "@/server/extensions/advisor/service";
import { persistSseEvent, type SseEventType } from "@/server/extensions/sse/event-persister";
import { createId, getDatabase, isoNow, json } from "@/server/http/context";

import {
  AdvocateSpeechSchema, DebateJudgementSchema, DebateRoundPlanSchema, DebateTurnSchema,
  type AdvocateSpeech, type DebateJudgement, type DebateRoundPlan, type DebateTurnType, type DebateUserRole,
} from "./contracts";
import { buildDebateEvidenceBoard, type DebateEvidenceBoard } from "./evidence";
import { createDebateArgument, createDebateJudgement, createDebateRoot, createDebateRound, createDebateTurn } from "./persistence";

export type DebateRunners = {
  plan: (prompt: string) => Promise<DebateRoundPlan>;
  advocate: (stance: "bull" | "bear", prompt: string) => Promise<AdvocateSpeech>;
  judge: (prompt: string) => Promise<DebateJudgement>;
  publish?: typeof runAdvisorPublicationGate;
};

type EvidenceCall = typeof buildDebateEvidenceBoard;
type StartInput = { userId: string; conversationId: string; message: string; targetSymbol?: string | null; initialUserRole?: DebateUserRole; runners?: DebateRunners; evidenceCall?: EvidenceCall };
type ContinueInput = { userId: string; debateSessionId: string; content: string; userRole?: DebateUserRole; runners?: DebateRunners; evidenceCall?: EvidenceCall };
type RoundInput = { userId: string; conversationId: string; debateSessionId: string; analysisId: string; content: string; userRole: DebateUserRole; targetSymbol: string | null; roundIndex: number; runners: DebateRunners; evidenceCall: EvidenceCall; userMessagePersisted: boolean };
type DebateResult = { debateSessionId: string; roundId: string; roundIndex: number; analysis: { analysisId: string; type: "DEBATE"; status: "COMPLETED"; streamUrl: string }; judgement: DebateJudgement; publication: AdvisorPublicationResult | null };
type DebateStarted = { debateSessionId: string; roundIndex: number; analysis: { analysisId: string; type: "DEBATE"; status: "RUNNING"; streamUrl: string } };
export type DebateBackgroundScheduler = (task: () => Promise<DebateResult>) => void;
export type DebateSessionErrorCode = "DEBATE_NOT_FOUND" | "DEBATE_BLOCKED" | "DEBATE_NOT_ACTIVE";

export class DebateSessionError extends Error {
  constructor(public readonly code: DebateSessionErrorCode, message: string) {
    super(message);
    this.name = "DebateSessionError";
  }
}

type Speaker = "user" | "evidence" | "bull" | "bear" | "judge";
type Stance = "bull" | "bear" | "neutral";

const defaultRunners: DebateRunners = { plan: runDebateOrchestrator, advocate: runDebateAdvocate, judge: runDebateJudge, publish: runAdvisorPublicationGate };

export async function startDebate(input: StartInput): Promise<DebateResult> {
  const prepared = prepareDebateStart(input);
  return runRound(prepared.round);
}

export function startDebateInBackground(input: StartInput, schedule: DebateBackgroundScheduler = scheduleImmediately): DebateStarted {
  const prepared = prepareDebateStart(input);
  schedule(() => runRound(prepared.round));
  return prepared.started;
}

export async function continueDebate(input: ContinueInput): Promise<DebateResult> {
  return runRound(prepareDebateContinuation(input).round);
}

export function continueDebateInBackground(input: ContinueInput, schedule: DebateBackgroundScheduler = scheduleImmediately): DebateStarted {
  const prepared = prepareDebateContinuation(input);
  schedule(() => runRound(prepared.round));
  return prepared.started;
}

function scheduleImmediately(task: () => Promise<DebateResult>): void {
  void task().catch(() => undefined);
}

function prepareDebateStart(input: StartInput): { round: RoundInput; started: DebateStarted } {
  const db = getDatabase();
  let root: { analysisId: string; debateSessionId: string };
  try {
    const conversation = db.prepare("SELECT id FROM conversation_sessions WHERE id=? AND user_id=? AND status='active'").get(input.conversationId, input.userId);
    if (!conversation) throw new Error("Conversation not found");
    root = createDebateRoot(db, {
      userId: input.userId,
      conversationId: input.conversationId,
      motion: input.message,
      targetSymbol: input.targetSymbol ?? null,
      userDebateRole: input.initialUserRole ?? "neutral",
      initialUserMessage: {
        content: input.message,
        metadata: {
          outputMode: "BATTLE",
          roundIndex: 1,
          userRole: input.initialUserRole ?? "neutral",
        },
      },
    });
  } finally {
    db.close();
  }
  const { analysisId, debateSessionId } = root;
  emit(analysisId, "debate.started", payload(debateSessionId, "", "orchestrator", "neutral", "opening", input.message));
  const round: RoundInput = {
    userId: input.userId, conversationId: input.conversationId, debateSessionId, analysisId, content: input.message,
    userRole: input.initialUserRole ?? "neutral", targetSymbol: input.targetSymbol ?? null, roundIndex: 1,
    runners: input.runners ?? defaultRunners, evidenceCall: input.evidenceCall ?? buildDebateEvidenceBoard, userMessagePersisted: true,
  };
  return { round, started: startedResult(round) };
}

function prepareDebateContinuation(input: ContinueInput): { round: RoundInput; started: DebateStarted } {
  const db = getDatabase();
  let session: Record<string, unknown> | undefined;
  let sessionError: DebateSessionError | null = null;
  try {
    const reserve = db.transaction(() => {
      session = db.prepare("SELECT * FROM debate_sessions WHERE id=? AND user_id=?")
        .get(input.debateSessionId, input.userId) as Record<string, unknown> | undefined;
      if (!session) return;
      const status = String(session.status ?? "").toLowerCase();
      if (status === "blocked") {
        sessionError = new DebateSessionError("DEBATE_BLOCKED", "Debate is blocked; start a new Battle");
        return;
      }
      if (status !== "active") {
        sessionError = new DebateSessionError("DEBATE_NOT_ACTIVE", "Debate is no longer active; start a new Battle");
        return;
      }
      const reserved = db.prepare(`UPDATE agent_runs
        SET status='running',completed_at=NULL,failure_code=NULL,failure_message=NULL
        WHERE id=? AND user_id=? AND status<>'running'`)
        .run(String(session.root_agent_run_id), input.userId);
      if (reserved.changes !== 1) throw new Error("RUN_ALREADY_ACTIVE");
      insertConversationMessage(db, String(session.conversation_id), "user", input.content, String(session.root_agent_run_id), {
        outputMode: "BATTLE",
        debateSessionId: input.debateSessionId,
        roundIndex: Number(session.current_round_index ?? 0) + 1,
        userRole: input.userRole ?? roleFrom(session.user_debate_role),
      });
    });
    reserve();
  } finally {
    db.close();
  }
  if (!session) throw new DebateSessionError("DEBATE_NOT_FOUND", "Debate not found");
  if (sessionError) throw sessionError;
  const round: RoundInput = {
    userId: input.userId, conversationId: String(session.conversation_id), debateSessionId: input.debateSessionId, analysisId: String(session.root_agent_run_id), content: input.content,
    userRole: input.userRole ?? roleFrom(session.user_debate_role), targetSymbol: typeof session.target_symbol === "string" ? session.target_symbol : null,
    roundIndex: Number(session.current_round_index ?? 0) + 1, runners: input.runners ?? defaultRunners,
    evidenceCall: input.evidenceCall ?? buildDebateEvidenceBoard, userMessagePersisted: true,
  };
  return { round, started: startedResult(round) };
}

async function runRound(input: RoundInput): Promise<DebateResult> {
  let roundId = "";
  try {
    const initialBoard = await input.evidenceCall({
      userId: input.userId, debateSessionId: input.debateSessionId, rootAgentRunId: input.analysisId,
      motion: currentMotion(input.debateSessionId, input.content), targetSymbol: input.targetSymbol, userClaims: [input.content],
    });
    const orchestratedPlan = await input.runners.plan(roundPlanPrompt(input.content, input.userRole, initialBoard));
    const plan = DebateRoundPlanSchema.parse({ ...orchestratedPlan, userDebateRole: input.userRole });
    const board = plan.needsFreshData
      ? await input.evidenceCall({
          userId: input.userId, debateSessionId: input.debateSessionId, rootAgentRunId: input.analysisId,
          motion: plan.motion, targetSymbol: input.targetSymbol, userClaims: [input.content],
        })
      : { ...initialBoard, motion: plan.motion };
    const userRole = input.userRole;
    roundId = persistRoundStart(input, plan, userRole);
    persistUserTurn(input.analysisId, input.debateSessionId, roundId, input.content, userRole);
    if (!input.userMessagePersisted) persistConversationMessage(input.debateSessionId, "user", input.content, input.analysisId, { outputMode: "BATTLE", debateSessionId: input.debateSessionId, roundIndex: input.roundIndex, userRole });
    const speeches = await runSpeakingOrder(input, roundId, plan, board, userRole);
    const judgement = await runJudge(input, roundId, plan, board, speeches);
    const publication = await publishDebateIfRequested(input, plan, speeches, judgement);
    completeAnalysisRun(input, roundId, plan.motion, judgement, publication);
    return result(input, roundId, judgement, publication);
  } catch (error) {
    markDebateBlocked(input, roundId, error);
    throw error;
  }
}

async function runSpeakingOrder(input: RoundInput, roundId: string, plan: DebateRoundPlan, board: DebateEvidenceBoard, userRole: DebateUserRole): Promise<AdvocateSpeech[]> {
  const speeches: AdvocateSpeech[] = [];
  const spoke = { bull: 0, bear: 0 };
  for (const agent of plan.speakingOrder) {
    if (agent === "evidence") persistEvidenceTurn(input.analysisId, input.debateSessionId, roundId, board);
    if (agent !== "bull" && agent !== "bear") continue;
    emit(input.analysisId, "debate.agent.started", payload(input.debateSessionId, roundId, agent, agent, "opening", `${agent} advocate started`));
    const speech = AdvocateSpeechSchema.parse(await input.runners.advocate(agent, advocatePrompt(agent, input.content, plan, board, speeches)));
    persistAdvocateTurn(input.analysisId, input.debateSessionId, roundId, speech, advocateTurnType(agent, userRole, spoke[agent]));
    spoke[agent] += 1;
    speeches.push(speech);
  }
  return speeches;
}

async function runJudge(input: RoundInput, roundId: string, plan: DebateRoundPlan, board: DebateEvidenceBoard, speeches: AdvocateSpeech[]): Promise<DebateJudgement> {
  emit(input.analysisId, "debate.judge.started", payload(input.debateSessionId, roundId, "judge", "neutral", "judge_summary", "Judge started"));
  const judgement = DebateJudgementSchema.parse(await input.runners.judge(judgePrompt(input.content, plan, board, speeches)));
  const db = getDatabase();
  createDebateJudgement(db, { debateSessionId: input.debateSessionId, debateRoundId: roundId, ...judgement });
  db.close();
  persistTurn(input.analysisId, input.debateSessionId, roundId, "judge", "neutral", "judge_summary", judgement.whyNotFinal, judgement.whyNotFinal, judgement);
  return judgement;
}

function persistRoundStart(input: RoundInput, plan: DebateRoundPlan, userRole: DebateUserRole): string {
  const db = getDatabase();
  const roundId = createDebateRound(db, { debateSessionId: input.debateSessionId, roundIndex: input.roundIndex, roundFocus: plan.roundFocus, userIntent: plan.userIntent });
  db.prepare("UPDATE debate_sessions SET user_debate_role=?,motion=?,updated_at=? WHERE id=?").run(userRole, plan.motion, isoNow(), input.debateSessionId);
  db.close();
  emit(input.analysisId, "debate.round.started", payload(input.debateSessionId, roundId, "orchestrator", "neutral", "opening", plan.roundFocus));
  return roundId;
}

function persistUserTurn(analysisId: string, debateSessionId: string, roundId: string, content: string, userRole: DebateUserRole): void {
  const stance = userRole === "bull" || userRole === "bear" ? userRole : "neutral";
  persistTurn(analysisId, debateSessionId, roundId, "user", stance, "support", content, content.slice(0, 240), { userRole });
}

function persistEvidenceTurn(analysisId: string, debateSessionId: string, roundId: string, board: DebateEvidenceBoard): void {
  emit(analysisId, "debate.evidence.started", payload(debateSessionId, roundId, "evidence", "neutral", "evidence_update", "Evidence board started"));
  const summary = evidenceSummary(board);
  persistTurn(analysisId, debateSessionId, roundId, "evidence", "neutral", "evidence_update", summary, summary, { board });
}

function persistAdvocateTurn(analysisId: string, debateSessionId: string, roundId: string, speech: AdvocateSpeech, turnType: DebateTurnType): void {
  const turnId = persistTurn(analysisId, debateSessionId, roundId, speech.stance, speech.stance, turnType, speechContent(speech), speech.plainLanguageSummary, speech);
  const db = getDatabase();
  for (const argument of speech.arguments) createDebateArgument(db, { debateTurnId: turnId, ...argument });
  db.close();
}

function persistTurn(analysisId: string, debateSessionId: string, roundId: string, speaker: Speaker, stance: Stance, turnType: DebateTurnType, content: string, publicSummary: string, structuredPayload: Record<string, unknown>): string {
  const turn = DebateTurnSchema.parse({ speaker, stance, turnType, content, publicSummary, structuredPayload });
  const db = getDatabase();
  const turnId = createDebateTurn(db, { ...turn, debateSessionId, debateRoundId: roundId });
  db.close();
  emit(analysisId, eventTypeFor(speaker), payload(debateSessionId, roundId, speaker, stance, turnType, publicSummary));
  return turnId;
}

function completeAnalysisRun(input: RoundInput, roundId: string, motion: string, judgement: DebateJudgement, publication: AdvisorPublicationResult | null): void {
  const db = getDatabase();
  const completedAt = isoNow();
  const persist = db.transaction(() => {
    const session = db.prepare("SELECT conversation_id FROM debate_sessions WHERE id=?")
      .get(input.debateSessionId) as { conversation_id?: string } | undefined;
    if (!session?.conversation_id) throw new Error("Debate conversation not found");
    db.prepare("UPDATE agent_runs SET output_summary=?,result_json=? WHERE id=?")
      .run(judgement.keyDisagreement, json({ debateSessionId: input.debateSessionId, roundId, judgement, publication }), input.analysisId);
    insertConversationMessage(
      db,
      session.conversation_id,
      "assistant",
      debateAssistantContent(judgement, publication),
      input.analysisId,
      {
        outputMode: "BATTLE",
        debateSessionId: input.debateSessionId,
        roundId,
        roundIndex: input.roundIndex,
        debateMotion: motion,
        publication,
      },
    );
    db.prepare("UPDATE debate_rounds SET status='completed',judge_summary_json=?,completed_at=? WHERE id=?")
      .run(json(judgement), completedAt, roundId);
    db.prepare("UPDATE debate_sessions SET updated_at=? WHERE id=?")
      .run(completedAt, input.debateSessionId);
  });
  try {
    persist();
  } finally {
    db.close();
  }
  emit(input.analysisId, "debate.round.completed", payload(
    input.debateSessionId,
    roundId,
    "judge",
    "neutral",
    "judge_summary",
    judgement.whyNotFinal,
    { roundIndex: input.roundIndex },
  ));
  const completedDb = getDatabase();
  completedDb.prepare("UPDATE agent_runs SET status='completed',completed_at=? WHERE id=?")
    .run(isoNow(), input.analysisId);
  completedDb.close();
}

function markDebateBlocked(input: RoundInput, roundId: string, error: unknown): void {
  const message = error instanceof Error ? error.message : "Debate round failed";
  persistConversationMessage(
    input.debateSessionId,
    "assistant",
    `Battle 暂时受阻：${message}`,
    input.analysisId,
    {
      outputMode: "BATTLE",
      debateSessionId: input.debateSessionId,
      roundId: roundId || null,
      roundIndex: input.roundIndex,
      debateMotion: currentMotion(input.debateSessionId, input.content),
      publication: null,
      status: "BLOCKED",
    },
  );
  const db = getDatabase();
  db.prepare("UPDATE agent_runs SET status='failed',completed_at=?,failure_code='DEBATE_FAILED',failure_message=? WHERE id=?").run(isoNow(), message.slice(0, 500), input.analysisId);
  if (roundId) db.prepare("UPDATE debate_rounds SET status='blocked',completed_at=? WHERE id=?").run(isoNow(), roundId);
  db.prepare("UPDATE debate_sessions SET status='blocked',updated_at=? WHERE id=?").run(isoNow(), input.debateSessionId);
  db.close();
  emit(input.analysisId, "debate.blocked", {
    debateSessionId: input.debateSessionId,
    roundId,
    roundIndex: input.roundIndex,
    speaker: "judge",
    stance: "neutral",
    turnType: "judge_summary",
    publicSummary: message.slice(0, 240),
  });
}

function result(input: RoundInput, roundId: string, judgement: DebateJudgement, publication: AdvisorPublicationResult | null): DebateResult {
  return { debateSessionId: input.debateSessionId, roundId, roundIndex: input.roundIndex, analysis: { analysisId: input.analysisId, type: "DEBATE", status: "COMPLETED", streamUrl: `/api/v1/debates/${input.debateSessionId}/events` }, judgement, publication };
}

function startedResult(input: RoundInput): DebateStarted {
  const afterEventId = latestEventId(input.analysisId);
  const streamUrl = `/api/v1/debates/${input.debateSessionId}/events${afterEventId ? `?after=${encodeURIComponent(afterEventId)}` : ""}`;
  return {
    debateSessionId: input.debateSessionId,
    roundIndex: input.roundIndex,
    analysis: {
      analysisId: input.analysisId,
      type: "DEBATE",
      status: "RUNNING",
      streamUrl,
    },
  };
}

function roundPlanPrompt(content: string, role: DebateUserRole, board: DebateEvidenceBoard): string {
  return JSON.stringify({
    userMessage: content,
    userRole: role,
    evidenceBoard: board,
    instruction: "请基于共同证据板生成本轮多空 Battle 计划，重点让理财小白能参与并理解证据缺口。每轮必须安排 evidence、bull、bear、judge。",
  }, null, 2);
}

function currentMotion(debateSessionId: string, fallback: string): string {
  const db = getDatabase();
  const row = db.prepare("SELECT motion FROM debate_sessions WHERE id=?").get(debateSessionId) as { motion?: string } | undefined;
  db.close();
  return row?.motion?.trim() || fallback;
}

function advocatePrompt(stance: "bull" | "bear", content: string, plan: DebateRoundPlan, board: DebateEvidenceBoard, speeches: AdvocateSpeech[]): string {
  return JSON.stringify({ stance, userMessage: content, plan, evidenceBoard: board, priorPublicSpeeches: speeches.map(summaryForPrompt) }, null, 2);
}

function judgePrompt(content: string, plan: DebateRoundPlan, board: DebateEvidenceBoard, speeches: AdvocateSpeech[]): string {
  return JSON.stringify({ userMessage: content, plan, evidenceBoard: board, publicSpeeches: speeches.map(summaryForPrompt) }, null, 2);
}

async function publishDebateIfRequested(input: RoundInput, plan: DebateRoundPlan, speeches: AdvocateSpeech[], judgement: DebateJudgement): Promise<AdvisorPublicationResult | null> {
  if (!plan.requiredAgents.includes("chief_advisor")) return null;
  if (!input.runners.publish) throw new Error("Chief Advisor publication runner unavailable");
  return input.runners.publish({
    userId: input.userId,
    sessionId: input.conversationId,
    rootAnalysisId: input.analysisId,
    content: buildDebateChiefAdvisorPrompt({
      motion: plan.motion,
      turns: [
        { speaker: "user", publicSummary: input.content },
        ...speeches.map((speech) => ({ speaker: speech.stance, publicSummary: speech.plainLanguageSummary })),
      ],
      judgements: [judgement],
    }),
    targetSymbol: input.targetSymbol,
  });
}

function summaryForPrompt(speech: AdvocateSpeech): Record<string, unknown> {
  return { stance: speech.stance, headline: speech.headline, summary: speech.plainLanguageSummary, admittedWeakness: speech.admittedWeakness };
}

function advocateTurnType(stance: "bull" | "bear", userRole: DebateUserRole, priorTurns: number): DebateTurnType {
  if (priorTurns > 0) return "answer";
  if (userRole === stance) return "support";
  return stance === "bull" ? "opening" : "rebuttal";
}

function eventTypeFor(speaker: Speaker): SseEventType {
  if (speaker === "judge") return "debate.judge.completed";
  if (speaker === "evidence") return "debate.evidence.completed";
  if (speaker === "user") return "debate.turn.completed";
  return "debate.agent.completed";
}

function payload(
  debateSessionId: string,
  roundId: string,
  speaker: string,
  stance: string,
  turnType: string,
  publicSummary: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { debateSessionId, roundId, speaker, stance, turnType, publicSummary, ...extra };
}

function emit(analysisId: string, type: SseEventType, payloadValue: Record<string, unknown>): void {
  persistSseEvent({ analysisId, type, payload: payloadValue });
}

function evidenceSummary(board: DebateEvidenceBoard): string {
  const facts = [...board.profileFacts, ...board.portfolioFacts, ...board.marketFacts].slice(0, 4);
  return facts.length ? `共同事实：${facts.join("；")}` : "共同事实不足，裁判需按证据不足处理。";
}

function persistConversationMessage(debateSessionId: string, role: "user" | "assistant", content: string, analysisId: string, metadata: Record<string, unknown>): void {
  const db = getDatabase();
  const row = db.prepare("SELECT conversation_id FROM debate_sessions WHERE id=?").get(debateSessionId) as { conversation_id?: string } | undefined;
  if (row?.conversation_id) insertConversationMessage(db, row.conversation_id, role, content, analysisId, metadata);
  db.close();
}

function insertConversationMessage(
  db: ReturnType<typeof getDatabase>,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  analysisId: string,
  metadata: Record<string, unknown>,
): void {
  db.prepare("INSERT INTO messages (id,session_id,role,content,created_at,agent_run_id,metadata_json) VALUES (?,?,?,?,?,?,?)")
    .run(createId("message"), conversationId, role, content, isoNow(), analysisId, json(metadata));
}

function latestEventId(analysisId: string): string | null {
  const db = getDatabase();
  const row = db.prepare(`SELECT id FROM agent_run_events
    WHERE COALESCE(root_run_id,agent_run_id)=?
    ORDER BY COALESCE(sequence_no,2147483647) DESC,created_at DESC,id DESC
    LIMIT 1`).get(analysisId) as { id?: string } | undefined;
  db.close();
  return row?.id ?? null;
}

function debateAssistantContent(judgement: DebateJudgement, publication: AdvisorPublicationResult | null): string {
  return [
    `裁判总结：${judgement.whyNotFinal}`,
    `多方最强点：${judgement.bullStrongestPoint}`,
    `空方最强点：${judgement.bearStrongestPoint}`,
    ...(publication ? [`Chief Advisor 发布门：${publication.answer}`] : []),
  ].join("\n");
}

function speechContent(speech: AdvocateSpeech): string { return [speech.headline, speech.directResponseToUser, speech.plainLanguageSummary].join("\n"); }

function roleFrom(value: unknown): DebateUserRole { return value === "bull" || value === "bear" ? value : "neutral"; }

export function buildDebateChiefAdvisorPrompt(input: { motion: string; turns: Array<{ speaker: string; publicSummary: string }>; judgements: DebateJudgement[] }): string {
  return [
    `辩题：${input.motion}`,
    `公开发言摘要：${JSON.stringify(input.turns.slice(-12))}`,
    `裁判总结：${JSON.stringify(input.judgements.slice(-3))}`,
    "请基于多空 Battle 的公开证据和裁判总结，生成模拟建议或阻断原因。不得将任一方胜负直接变成交易指令。",
  ].join("\n");
}
