import {
  buildDebateChiefAdvisorPrompt,
  continueDebate,
  startDebate,
} from "@/server/extensions/debate/service";
import {
  DebateJudgementSchema,
  type DebateJudgement,
} from "@/server/extensions/debate/contracts";
import { runAdvisorPublicationGate } from "@/server/extensions/advisor/service";
import { getDatabase, isoNow, parseJson } from "@/server/http/context";

import {
  A2APublicError,
  type A2ATaskView,
  type CapabilityAdapterInput,
} from "../contracts";
import {
  completeA2ATask,
  setA2ATaskDomainResource,
  startA2ATask,
} from "../task-service";

export async function runDebateCapability(input: CapabilityAdapterInput): Promise<A2ATaskView> {
  const allowedOperations = new Set([
    "start",
    "continue",
    "question_bull",
    "question_bear",
    "join_bull",
    "join_bear",
    "summarize",
    "finalize",
  ]);
  if (!allowedOperations.has(input.operation)) {
    throw new A2APublicError("INVALID_OPERATION", 422, "Unsupported debate operation");
  }
  startA2ATask(input.principal.clientId, input.task.id);
  const conversationId = ensureConversation(input.context.executionUserId, input.context.id, input.text);
  if (input.operation === "summarize") {
    return completeWithSession(input, loadDebate(input, conversationId));
  }
  if (input.operation === "finalize") {
    return finalizeDebate(input, conversationId);
  }
  const result = input.operation === "start"
    ? await startDebate({
        userId: input.context.executionUserId,
        conversationId,
        message: input.text,
        targetSymbol: optionalString(input.input.targetSymbol),
        initialUserRole: roleFor(input.operation, input.input.userRole),
      })
    : await continueDebate({
        userId: input.context.executionUserId,
        debateSessionId: requiredSessionId(input, conversationId),
        content: input.text,
        userRole: roleFor(input.operation, input.input.userRole),
        preferredFirstSpeaker: input.operation === "question_bull"
          ? "bull"
          : input.operation === "question_bear"
            ? "bear"
            : undefined,
      });
  setA2ATaskDomainResource(
    input.principal.clientId,
    input.task.id,
    "debate_session",
    result.debateSessionId,
  );
  return completeA2ATask(input.principal.clientId, input.task.id, {
    message: debateText(result.judgement, result.publication?.answer),
    artifacts: [{
      artifactId: result.roundId,
      name: "debate_round",
      text: debateText(result.judgement, result.publication?.answer),
      data: {
        debateSessionId: result.debateSessionId,
        roundId: result.roundId,
        roundIndex: result.roundIndex,
        judgement: result.judgement,
        publication: result.publication,
      },
    }],
  });
}

function finalizeDebate(input: CapabilityAdapterInput, conversationId: string): Promise<A2ATaskView> {
  const session = loadDebate(input, conversationId);
  const prompt = buildDebateChiefAdvisorPrompt({
    motion: session.motion,
    turns: session.turns,
    judgements: session.judgements,
  });
  return runAdvisorPublicationGate({
    userId: input.context.executionUserId,
    sessionId: conversationId,
    rootAnalysisId: session.rootAnalysisId,
    content: prompt,
    targetSymbol: session.targetSymbol,
  }).then((publication) => {
    const db = getDatabase();
    db.prepare("UPDATE debate_sessions SET status='completed',updated_at=? WHERE id=? AND user_id=?")
      .run(isoNow(), session.id, input.context.executionUserId);
    db.close();
    setA2ATaskDomainResource(input.principal.clientId, input.task.id, "debate_session", session.id);
    return completeA2ATask(input.principal.clientId, input.task.id, {
      message: publication.answer,
      artifacts: [{
        artifactId: session.id,
        name: "debate_summary",
        text: publication.answer,
        data: { ...session, publication },
      }],
    });
  });
}

function completeWithSession(input: CapabilityAdapterInput, session: DebateView): A2ATaskView {
  setA2ATaskDomainResource(input.principal.clientId, input.task.id, "debate_session", session.id);
  const text = session.judgements.at(-1)?.whyNotFinal ?? "Debate summary is not available yet.";
  return completeA2ATask(input.principal.clientId, input.task.id, {
    message: text,
    artifacts: [{ artifactId: session.id, name: "debate_summary", text, data: session }],
  });
}

type DebateView = {
  id: string;
  motion: string;
  rootAnalysisId: string;
  targetSymbol: string | null;
  turns: Array<{ speaker: string; publicSummary: string }>;
  judgements: DebateJudgement[];
};

function loadDebate(input: CapabilityAdapterInput, conversationId: string): DebateView {
  const db = getDatabase();
  const requested = optionalString(input.input.debateSessionId);
  const session = db.prepare(`SELECT * FROM debate_sessions
    WHERE user_id=? AND conversation_id=? AND (? IS NULL OR id=?)
    ORDER BY updated_at DESC LIMIT 1`).get(
    input.context.executionUserId,
    conversationId,
    requested,
    requested,
  ) as Record<string, unknown> | undefined;
  if (!session) {
    db.close();
    throw new A2APublicError("DEBATE_NOT_FOUND", 404, "Debate not found");
  }
  const turns = db.prepare(`SELECT speaker,public_summary FROM debate_turns
    WHERE debate_session_id=? ORDER BY created_at,id`).all(session.id) as Array<Record<string, unknown>>;
  const judgementRows = db.prepare(`SELECT * FROM debate_judgements
    WHERE debate_session_id=? ORDER BY created_at,id`).all(session.id) as Array<Record<string, unknown>>;
  db.close();
  return {
    id: String(session.id),
    motion: String(session.motion),
    rootAnalysisId: String(session.root_agent_run_id),
    targetSymbol: session.target_symbol == null ? null : String(session.target_symbol),
    turns: turns.map((turn) => ({ speaker: String(turn.speaker), publicSummary: String(turn.public_summary) })),
    judgements: judgementRows.map((row) => DebateJudgementSchema.parse({
      userClaim: String(row.user_claim ?? ""),
      bullStrongestPoint: String(row.bull_strongest_point ?? ""),
      bearStrongestPoint: String(row.bear_strongest_point ?? ""),
      keyDisagreement: String(row.key_disagreement ?? ""),
      responseQuality: parseJson(String(row.response_quality_json ?? "{}"), {}),
      evidenceTilt: String(row.evidence_tilt ?? ""),
      confidence: Number(row.confidence_decimal ?? 0),
      whyNotFinal: String(row.why_not_final ?? ""),
      suggestedNextPrompts: parseJson(String(row.suggested_next_prompts_json ?? "[]"), []),
      complianceNote: String(row.compliance_note ?? ""),
    })),
  };
}

function requiredSessionId(input: CapabilityAdapterInput, conversationId: string): string {
  return loadDebate(input, conversationId).id;
}

function ensureConversation(userId: string, contextId: string, text: string): string {
  const id = `${contextId}:debate`;
  const now = isoNow();
  const db = getDatabase();
  db.prepare(`INSERT INTO conversation_sessions (id,user_id,title,status,created_at,updated_at,row_version)
    VALUES (?,?,?,'active',?,?,1)
    ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at`).run(
    id,
    userId,
    text.slice(0, 80) || "External debate",
    now,
    now,
  );
  db.close();
  return id;
}

function roleFor(operation: string, value: unknown): "neutral" | "bull" | "bear" {
  if (operation === "join_bull") return "bull";
  if (operation === "join_bear") return "bear";
  return value === "bull" || value === "bear" ? value : "neutral";
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function debateText(judgement: Record<string, unknown>, publication?: string): string {
  return [
    `Bull: ${String(judgement.bullStrongestPoint ?? "")}`,
    `Bear: ${String(judgement.bearStrongestPoint ?? "")}`,
    `Judge: ${String(judgement.whyNotFinal ?? judgement.keyDisagreement ?? "")}`,
    publication ? `Chief Advisor: ${publication}` : "",
  ].filter(Boolean).join("\n");
}
