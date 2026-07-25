import { runDebateAdvocate, runDebateJudge, runDebateOrchestrator } from "@/mastra/agents/debate-agents";
import { persistSseEvent, type SseEventType } from "@/server/extensions/sse/event-persister";
import { createId, getDatabase, isoNow, json } from "@/server/http/context";

import {
  AdvocateSpeechSchema, DebateJudgementSchema, DebateRoundPlanSchema, DebateTurnSchema,
  type AdvocateSpeech, type DebateJudgement, type DebateRoundPlan, type DebateTurnType, type DebateUserRole,
} from "./contracts";
import { buildDebateEvidenceBoard, type DebateEvidenceBoard } from "./evidence";
import { createDebateArgument, createDebateJudgement, createDebateRound, createDebateSession, createDebateTurn } from "./persistence";

export type DebateRunners = {
  plan: (prompt: string) => Promise<DebateRoundPlan>;
  advocate: (stance: "bull" | "bear", prompt: string) => Promise<AdvocateSpeech>;
  judge: (prompt: string) => Promise<DebateJudgement>;
};

type EvidenceCall = typeof buildDebateEvidenceBoard;
type StartInput = { userId: string; conversationId: string; message: string; targetSymbol?: string | null; initialUserRole?: DebateUserRole; runners?: DebateRunners; evidenceCall?: EvidenceCall };
type ContinueInput = { userId: string; debateSessionId: string; content: string; userRole?: DebateUserRole; runners?: DebateRunners; evidenceCall?: EvidenceCall };
type RoundInput = { userId: string; debateSessionId: string; analysisId: string; content: string; userRole: DebateUserRole; targetSymbol: string | null; roundIndex: number; runners: DebateRunners; evidenceCall: EvidenceCall };
type DebateResult = { debateSessionId: string; roundId: string; roundIndex: number; analysis: { analysisId: string; type: "DEBATE"; status: "COMPLETED"; streamUrl: string }; judgement: DebateJudgement };
type Speaker = "user" | "evidence" | "bull" | "bear" | "judge";
type Stance = "bull" | "bear" | "neutral";

const defaultRunners: DebateRunners = { plan: runDebateOrchestrator, advocate: runDebateAdvocate, judge: runDebateJudge };

export async function startDebate(input: StartInput): Promise<DebateResult> {
  const now = isoNow();
  const analysisId = createId("analysis");
  const db = getDatabase();
  const conversation = db.prepare("SELECT id FROM conversation_sessions WHERE id=? AND user_id=? AND status='active'").get(input.conversationId, input.userId);
  if (!conversation) { db.close(); throw new Error("Conversation not found"); }
  db.prepare(`INSERT INTO agent_runs (id,user_id,type,status,session_id,agent_type,objective,created_at,started_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(analysisId, input.userId, "debate_agent", "running", input.conversationId, "debate_orchestrator", input.message.slice(0, 500), now, now);
  const debateSessionId = createDebateSession(db, {
    userId: input.userId, conversationId: input.conversationId, rootAgentRunId: analysisId,
    motion: input.message, targetSymbol: input.targetSymbol ?? null, userDebateRole: input.initialUserRole ?? "neutral",
  });
  db.close();
  emit(analysisId, "debate.started", payload(debateSessionId, "", "orchestrator", "neutral", "opening", input.message));
  return runRound({
    userId: input.userId, debateSessionId, analysisId, content: input.message,
    userRole: input.initialUserRole ?? "neutral", targetSymbol: input.targetSymbol ?? null, roundIndex: 1,
    runners: input.runners ?? defaultRunners, evidenceCall: input.evidenceCall ?? buildDebateEvidenceBoard,
  });
}

export async function continueDebate(input: ContinueInput): Promise<DebateResult> {
  const db = getDatabase();
  const session = db.prepare("SELECT * FROM debate_sessions WHERE id=? AND user_id=? AND status='active'").get(input.debateSessionId, input.userId) as Record<string, unknown> | undefined;
  db.close();
  if (!session) throw new Error("Debate not found");
  return runRound({
    userId: input.userId, debateSessionId: input.debateSessionId, analysisId: String(session.root_agent_run_id), content: input.content,
    userRole: input.userRole ?? roleFrom(session.user_debate_role), targetSymbol: typeof session.target_symbol === "string" ? session.target_symbol : null,
    roundIndex: Number(session.current_round_index ?? 0) + 1, runners: input.runners ?? defaultRunners,
    evidenceCall: input.evidenceCall ?? buildDebateEvidenceBoard,
  });
}

async function runRound(input: RoundInput): Promise<DebateResult> {
  let roundId = "";
  try {
    const plan = DebateRoundPlanSchema.parse(await input.runners.plan(roundPlanPrompt(input.content, input.userRole)));
    const userRole = input.userRole === "neutral" ? plan.userDebateRole : input.userRole;
    roundId = persistRoundStart(input, plan, userRole);
    persistUserTurn(input.analysisId, input.debateSessionId, roundId, input.content, userRole);
    const board = await input.evidenceCall({
      userId: input.userId, debateSessionId: input.debateSessionId, rootAgentRunId: input.analysisId,
      motion: plan.motion, targetSymbol: input.targetSymbol, userClaims: [input.content],
    });
    const speeches = await runSpeakingOrder(input, roundId, plan, board, userRole);
    const judgement = await runJudge(input, roundId, plan, board, speeches);
    completeAnalysisRun(input.analysisId, input.debateSessionId, roundId, judgement);
    return result(input, roundId, judgement);
  } catch (error) {
    markDebateBlocked(input.analysisId, input.debateSessionId, roundId, error);
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

function completeAnalysisRun(analysisId: string, debateSessionId: string, roundId: string, judgement: DebateJudgement): void {
  const db = getDatabase();
  db.prepare("UPDATE agent_runs SET status='completed',completed_at=?,output_summary=?,result_json=? WHERE id=?")
    .run(isoNow(), judgement.keyDisagreement, json({ debateSessionId, roundId, judgement }), analysisId);
  db.close();
  emit(analysisId, "debate.round.completed", payload(debateSessionId, roundId, "judge", "neutral", "judge_summary", judgement.whyNotFinal));
}

function markDebateBlocked(analysisId: string, debateSessionId: string, roundId: string, error: unknown): void {
  const message = error instanceof Error ? error.message : "Debate round failed";
  const db = getDatabase();
  db.prepare("UPDATE agent_runs SET status='failed',completed_at=?,failure_code='DEBATE_FAILED',failure_message=? WHERE id=?").run(isoNow(), message.slice(0, 500), analysisId);
  if (roundId) db.prepare("UPDATE debate_rounds SET status='blocked',completed_at=? WHERE id=?").run(isoNow(), roundId);
  db.prepare("UPDATE debate_sessions SET status='blocked',updated_at=? WHERE id=?").run(isoNow(), debateSessionId);
  db.close();
  emit(analysisId, "debate.blocked", { debateSessionId, roundId, speaker: "judge", stance: "neutral", turnType: "judge_summary", publicSummary: message.slice(0, 240) });
}

function result(input: RoundInput, roundId: string, judgement: DebateJudgement): DebateResult {
  return { debateSessionId: input.debateSessionId, roundId, roundIndex: input.roundIndex, analysis: { analysisId: input.analysisId, type: "DEBATE", status: "COMPLETED", streamUrl: `/api/v1/debates/${input.debateSessionId}/events` }, judgement };
}

function roundPlanPrompt(content: string, role: DebateUserRole): string {
  return [`用户消息：${content}`, `用户身份：${role}`, "请生成本轮多空 Battle 计划，重点让理财小白能参与并理解证据缺口。"].join("\n");
}

function advocatePrompt(stance: "bull" | "bear", content: string, plan: DebateRoundPlan, board: DebateEvidenceBoard, speeches: AdvocateSpeech[]): string {
  return JSON.stringify({ stance, userMessage: content, plan, evidenceBoard: board, priorPublicSpeeches: speeches.map(summaryForPrompt) }, null, 2);
}

function judgePrompt(content: string, plan: DebateRoundPlan, board: DebateEvidenceBoard, speeches: AdvocateSpeech[]): string {
  return JSON.stringify({ userMessage: content, plan, evidenceBoard: board, publicSpeeches: speeches.map(summaryForPrompt) }, null, 2);
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

function payload(debateSessionId: string, roundId: string, speaker: string, stance: string, turnType: string, publicSummary: string): Record<string, unknown> {
  return { debateSessionId, roundId, speaker, stance, turnType, publicSummary };
}

function emit(analysisId: string, type: SseEventType, payloadValue: Record<string, unknown>): void {
  persistSseEvent({ analysisId, type, payload: payloadValue });
}

function evidenceSummary(board: DebateEvidenceBoard): string {
  const facts = [...board.profileFacts, ...board.portfolioFacts, ...board.marketFacts].slice(0, 4);
  return facts.length ? `共同事实：${facts.join("；")}` : "共同事实不足，裁判需按证据不足处理。";
}

function speechContent(speech: AdvocateSpeech): string {
  return [speech.headline, speech.directResponseToUser, speech.plainLanguageSummary].join("\n");
}

function roleFrom(value: unknown): DebateUserRole {
  return value === "bull" || value === "bear" ? value : "neutral";
}
