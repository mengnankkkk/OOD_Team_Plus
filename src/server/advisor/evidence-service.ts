import { AdvisorError } from "@/server/advisor/http";
import type { AdvisorStore } from "@/server/advisor/store";

export class EvidenceService {
  constructor(private readonly store: AdvisorStore) {}

  getPack(analysisId: string, includeToolPayload = false) {
    const run = this.store.getRun(analysisId);
    if (!run) throw new AdvisorError("RESOURCE_NOT_FOUND", "分析不存在。", 404);
    const events = this.store.listEvents(analysisId);
    const recommendation = this.store.getRecommendationForAnalysis(analysisId);
    const diagnostic = this.store.analysis.getDiagnosticByAnalysis(analysisId);
    const toolCalls = events
      .filter((event) => event.type === "tool.started" || event.type === "tool.completed" || event.type === "tool.failed")
      .map((event) => ({
        eventId: event.id,
        type: event.type,
        toolName: String(event.payload.toolName ?? ""),
        inputSummary: event.payload.inputSummary ?? null,
        outputSummary: event.payload.outputSummary ?? null,
        code: event.payload.code ?? null,
        ...(includeToolPayload ? { payload: event.payload } : {}),
      }));
    const agentRuns = this.store.listRuns(analysisId).map((item) => ({
      id: item.id,
      role: item.role,
      objective: item.objective,
      status: item.status.toUpperCase(),
      summary: item.summary,
      startedAt: item.createdAt,
      completedAt: item.completedAt,
    }));
    const dataSources = readDataSources(diagnostic?.details);

    return {
      analysisId,
      evidence: this.store.listEvidence(analysisId),
      agentRuns,
      toolCalls,
      events,
      dataFreshness: dataSources,
      compliance: recommendation
        ? {
            status: recommendation.status,
            suitability: recommendation.suitability,
            confidence: recommendation.confidence,
            invalidationConditions: recommendation.invalidationConditions ?? [],
          }
        : null,
    };
  }
}

function readDataSources(details: Record<string, unknown> | undefined) {
  const sources = Array.isArray(details?.dataSources) ? details.dataSources : [];
  return sources.map((source) => {
    const item = source as Record<string, unknown>;
    const pandadata = (item.pandadata ?? {}) as Record<string, unknown>;
    return {
      instrumentId: item.instrumentId ?? null,
      source: item.source ?? "unknown",
      dataAsOf: item.dataAsOf ?? null,
      live: pandadata.liveCallSucceeded === true && pandadata.liveDataFresh === true,
      freshness: pandadata.liveDataFresh === true ? "FRESH" : "DEGRADED",
      summary: pandadata.summary ?? null,
    };
  });
}
