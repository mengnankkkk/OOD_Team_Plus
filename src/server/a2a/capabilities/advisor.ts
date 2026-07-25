import { answerA2AClarification } from "../clarification";
import {
  A2APublicError,
  type A2ATaskView,
  type CapabilityAdapterInput,
} from "../contracts";
import {
  completeA2ATask,
  failA2ATask,
  requireInputForA2ATask,
  setA2ATaskDomainResource,
  startA2ATask,
} from "../task-service";
import {
  runConversationAgent,
  type ConversationOutputMode,
} from "@/server/extensions/advisor/service";
import { getDatabase, isoNow } from "@/server/http/context";

type AdvisorResult = {
  assistantMessageId?: string;
  analysis?: { analysisId?: string; status?: string };
  answer?: string | null;
  recommendationId?: string | null;
  missingQuestions?: string[];
  dataQueryId?: string | null;
  outputMode?: string;
  artifact?: unknown;
  clarificationId?: string | null;
};

export async function runAdvisorCapability(input: CapabilityAdapterInput): Promise<A2ATaskView> {
  if (!["send", "answer_clarification"].includes(input.operation)) {
    throw new A2APublicError("INVALID_OPERATION", 422, "Unsupported Chief Advisor operation");
  }
  startA2ATask(input.principal.clientId, input.task.id);
  const sessionId = ensureConversation(input.context.executionUserId, input.context.id, input.text);
  try {
    const result = input.operation === "answer_clarification"
      ? await answerA2AClarification({
          userId: input.context.executionUserId,
          sessionId,
          clarificationId: requiredString(input.input.clarificationId, "clarificationId"),
          text: input.text,
          messageId: input.messageId,
          outputMode: outputMode(input.acceptedOutputModes),
        })
      : await runConversationAgent({
          userId: input.context.executionUserId,
          sessionId,
          content: input.text,
          clientMessageId: input.messageId,
          outputMode: outputMode(input.acceptedOutputModes),
        });
    return publishAdvisorResult(input, result as AdvisorResult);
  } catch (error) {
    const publicError = new A2APublicError(
      "ADVISOR_FAILED",
      502,
      error instanceof Error ? error.message : "Chief Advisor failed",
    );
    failA2ATask(input.principal.clientId, input.task.id, {
      code: publicError.code,
      message: publicError.message,
      status: publicError.status,
      retryable: true,
    });
    throw publicError;
  }
}

function publishAdvisorResult(input: CapabilityAdapterInput, result: AdvisorResult): A2ATaskView {
  const analysisId = result.analysis?.analysisId ?? input.task.id;
  setA2ATaskDomainResource(input.principal.clientId, input.task.id, "advisor_analysis", analysisId);
  const answer = withRiskNotice(result.answer ?? "The task completed without a publishable conclusion.");
  const taskResult = {
    message: answer,
    artifacts: [{
      artifactId: result.recommendationId ?? analysisId,
      name: "advisor_result",
      text: answer,
      data: {
        analysisId,
        recommendationId: result.recommendationId ?? null,
        missingQuestions: result.missingQuestions ?? [],
        clarificationId: result.clarificationId ?? null,
        dataQueryId: result.dataQueryId ?? null,
        outputMode: result.outputMode ?? "SQL_ONLY",
        generatedArtifact: result.artifact ?? null,
      },
    }],
  };
  if (result.analysis?.status === "WAITING_FOR_USER") {
    return requireInputForA2ATask(input.principal.clientId, input.task.id, taskResult);
  }
  if (result.analysis?.status === "FAILED") {
    return failA2ATask(input.principal.clientId, input.task.id, {
      code: "ADVISOR_FAILED",
      message: answer,
      status: 502,
      retryable: true,
    });
  }
  return completeA2ATask(input.principal.clientId, input.task.id, taskResult);
}

function ensureConversation(userId: string, contextId: string, text: string): string {
  const id = `${contextId}:advisor`;
  const now = isoNow();
  const db = getDatabase();
  db.prepare(`INSERT INTO conversation_sessions (id,user_id,title,status,created_at,updated_at,row_version)
    VALUES (?,?,?,'active',?,?,1)
    ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at`).run(
    id,
    userId,
    text.replaceAll(/\s+/gu, " ").slice(0, 80) || "External advisor",
    now,
    now,
  );
  db.close();
  return id;
}

function outputMode(modes: string[]): ConversationOutputMode {
  const normalized = modes.map((mode) => mode.toLowerCase());
  if (normalized.some((mode) => mode.includes("json") || mode.includes("chart"))) return "CHART";
  if (normalized.some((mode) => mode.includes("markdown") || mode.includes("report"))) return "FINANCIAL_REPORT";
  return "SQL_ONLY";
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new A2APublicError("INVALID_REQUEST", 422, `${name} is required`);
  }
  return value.trim();
}

function withRiskNotice(answer: string): string {
  if (/不构成|risk notice|investment advice/iu.test(answer)) return answer;
  return `${answer}\n\nRisk notice: This output is for research and simulation only. It is not investment advice, an order, or a return guarantee.`;
}
