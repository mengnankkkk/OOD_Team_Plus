import { type AdvisorAgentRuntime, type AdvisorAgentRuntimeOutput } from "@/server/advisor/agents";
import { DeterministicAdvisorRuntime } from "@/server/advisor/fallback-runtime";
import { hasActionablePandadata, type PandadataProbe } from "@/server/advisor/pandadata";
import { PortfolioService } from "@/server/advisor/portfolio-service";
import { buildAdvisorRecommendation } from "@/server/advisor/recommendation-builder";
import { emitResearchEvidence } from "@/server/advisor/research-presentation";
import { createAdvisorAgentRuntime } from "@/server/advisor/runtime-factory";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import type { AdvisorAgentFinding } from "@/server/advisor/schemas";
import { advisorStore, type AdvisorStore } from "@/server/advisor/store";
import type { AdvisorAgentRole } from "@/server/advisor/types";

type RunResult = {
  analysisId: string;
  recommendationId: string;
  status: "COMPLETED" | "BLOCKED";
  streamUrl: string;
};

type RuntimeEvent = NonNullable<Parameters<AdvisorAgentRuntime["run"]>[0]["emit"]> extends (
  event: infer Event,
) => void
  ? Event
  : never;

function emitFindingEvidence(store: AdvisorStore, analysisId: string, finding: AdvisorAgentFinding) {
  for (const summary of finding.supportEvidence) {
    store.addEvidence({ analysisId, stance: "support", kind: "rule_hit", source: "derived_engine", summary });
  }
  for (const summary of finding.counterEvidence) {
    store.addEvidence({ analysisId, stance: "counter", kind: "rule_hit", source: "derived_engine", summary });
  }
  for (const summary of finding.missingInformation) {
    store.addEvidence({ analysisId, stance: "missing", kind: "missing_data", source: "system", summary });
  }
}

function emitDataEvidence(store: AdvisorStore, analysisId: string, dataResults: PandadataProbe[]) {
  for (const result of dataResults) {
    store.addEvidence({
      analysisId,
      stance: hasActionablePandadata(result) ? "support" : "missing",
      kind: hasActionablePandadata(result) ? "market_fact" : "missing_data",
      source: "pandadata",
      summary: result.summary,
    });
  }
}

function createRuntimeEventSink(store: AdvisorStore, conversationId: string, analysisId: string) {
  const openRuns = new Map<AdvisorAgentRole, string[]>();
  return (event: RuntimeEvent) => {
    if (event.type === "agent.started") {
      const run = store.createRun({ conversationId, parentRunId: analysisId, rootRunId: analysisId, role: event.role, objective: event.label });
      store.updateRun(run.id, { status: "running" });
      openRuns.set(event.role, [...(openRuns.get(event.role) ?? []), run.id]);
      store.appendEvent({ analysisId, conversationId, type: "agent.started", payload: { agent: event.role, label: event.label } });
    }
    if (event.type === "agent.completed") {
      const runId = openRuns.get(event.role)?.at(-1);
      if (runId) store.updateRun(runId, { status: "succeeded", summary: event.summary });
      store.appendEvent({ analysisId, conversationId, type: "agent.completed", payload: { agent: event.role, summary: event.summary } });
    }
    if (event.type === "tool.started") {
      store.appendEvent({ analysisId, conversationId, type: "tool.started", payload: { toolName: event.toolName, inputSummary: event.inputSummary } });
    }
    if (event.type === "tool.completed" || event.type === "tool.failed") {
      store.appendEvent({
        analysisId,
        conversationId,
        type: event.type,
        payload: { toolName: event.toolName, outputSummary: event.outputSummary, code: event.result.errorCode },
      });
    }
  };
}

export async function runAdvisorConversation(input: {
  conversationId: string;
  question: string;
  store?: AdvisorStore;
  agentRuntime?: AdvisorAgentRuntime;
  existingAnalysisId?: string;
  triggerMessageId?: string;
  abortSignal?: AbortSignal;
}): Promise<RunResult> {
  const store = input.store ?? advisorStore;
  const agentRuntime = input.agentRuntime ?? createAdvisorAgentRuntime(store);
  let modelFallback = agentRuntime instanceof DeterministicAdvisorRuntime;
  const root = input.existingAnalysisId
    ? store.getRun(input.existingAnalysisId)
    : store.createRun({
        conversationId: input.conversationId,
        parentRunId: null,
        role: "chief_advisor",
        objective: "Agentic 多 Agent 对话理财咨询",
        triggerMessageId: input.triggerMessageId,
      });
  if (!root) throw new Error("RESOURCE_NOT_FOUND");

  if (input.abortSignal?.aborted) throw new Error("ANALYSIS_CANCELLED");
  store.updateRun(root.id, { status: "running", stage: "planning" });
  if (store.listEvents(root.id).length === 0) {
    store.appendEvent({ analysisId: root.id, conversationId: input.conversationId, type: "run.started", payload: { type: "ADVISORY_QA" } });
  }
  store.appendEvent({ analysisId: root.id, conversationId: input.conversationId, type: "supervisor.plan", payload: { mode: "mastra_supervisor_dynamic_delegation" } });
  store.appendEvent({ analysisId: root.id, conversationId: input.conversationId, type: "tool.started", payload: { toolName: "portfolio.buildSnapshot", inputSummary: "读取持仓、行情和组合风险" } });
  const portfolio = await new PortfolioService(store).buildSnapshot(DEMO_USER_ID, "recommendation");
  if (input.abortSignal?.aborted) throw new Error("ANALYSIS_CANCELLED");
  store.analysis.saveDiagnostic({ userId: DEMO_USER_ID, analysisId: root.id, type: "PORTFOLIO_DIAGNOSTIC", status: "succeeded", portfolioSnapshotId: portfolio.snapshotId, details: portfolio.diagnostic });
  store.appendEvent({ analysisId: root.id, conversationId: input.conversationId, type: "tool.completed", payload: { toolName: "portfolio.buildSnapshot", outputSummary: "组合快照与风险诊断已生成" } });

  let output: AdvisorAgentRuntimeOutput;
  try {
    output = await agentRuntime.run({
      conversationId: input.conversationId,
      question: input.question,
      emit: createRuntimeEventSink(store, input.conversationId, root.id),
      abortSignal: input.abortSignal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent runtime failed";
    if (!isRecoverableModelError(message)) {
      store.updateRun(root.id, { status: "failed", stage: "FINALIZED", errorCode: "MODEL_UNAVAILABLE", errorMessage: message.slice(0, 200) });
      store.appendEvent({ analysisId: root.id, conversationId: input.conversationId, type: "run.failed", payload: { code: "MODEL_UNAVAILABLE", message: "Agent runtime 暂时不可用。" } });
      throw error;
    }
    store.appendEvent({
      analysisId: root.id,
      conversationId: input.conversationId,
      type: "stage.changed",
      payload: { stage: "DEGRADED_FALLBACK", reason: "MODEL_UNAVAILABLE", message: "模型不可用，切换为结构化降级建议。" },
    });
    modelFallback = true;
    output = await new DeterministicAdvisorRuntime(store).run({
      conversationId: input.conversationId,
      question: input.question,
      emit: createRuntimeEventSink(store, input.conversationId, root.id),
      abortSignal: input.abortSignal,
    });
  }
  for (const finding of output.findings) emitFindingEvidence(store, root.id, finding);
  emitDataEvidence(store, root.id, [...output.dataResults, ...portfolio.marketResults.map((result) => result.pandadata).filter((result): result is PandadataProbe => Boolean(result))]);
  emitResearchEvidence(store, root.id, output.researchBundles ?? []);

  const recommendation = buildAdvisorRecommendation(store, root.id, input.conversationId, output, portfolio, modelFallback);
  const blocked = recommendation.status === "BLOCKED";
  store.appendEvent({
    analysisId: root.id,
    conversationId: input.conversationId,
    type: "recommendation.created",
    payload: { recommendationId: recommendation.id, action: recommendation.action, status: recommendation.status },
  });
  store.updateRun(root.id, { status: blocked ? "blocked" : "succeeded", summary: recommendation.summary });
  store.appendEvent({
    analysisId: root.id,
    conversationId: input.conversationId,
    type: blocked ? "run.blocked" : "run.completed",
    payload: { recommendationId: recommendation.id },
  });

  return {
    analysisId: root.id,
    recommendationId: recommendation.id,
    status: blocked ? "BLOCKED" : "COMPLETED",
    streamUrl: `/api/v1/analyses/${root.id}/events`,
  };
}

function isRecoverableModelError(message: string) {
  return /invalid token|invalid api key|unauthorized|status code 401|\b401\b|ai_apicallerror|model unavailable|fetch failed|econn|etimedout|timeout/i.test(message);
}
