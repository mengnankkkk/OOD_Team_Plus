import type { AdvisorAgentRuntimeOutput } from "@/server/advisor/agents";
import { hasActionablePandadata, type PandadataProbe } from "@/server/advisor/pandadata";
import type { PortfolioBuild } from "@/server/advisor/portfolio-service";
import { toStockResearchCard } from "@/server/advisor/research-presentation";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import type { AdvisorDecision } from "@/server/advisor/schemas";
import type { AdvisorStore } from "@/server/advisor/store";
import type {
  AdvisorAgentRole,
  RecommendationCard,
  RecommendationStatus,
} from "@/server/advisor/types";

type DegradationReason = NonNullable<RecommendationCard["degradationReasons"]>[number];

export function buildAdvisorRecommendation(
  store: AdvisorStore,
  analysisId: string,
  conversationId: string,
  output: AdvisorAgentRuntimeOutput,
  portfolio: PortfolioBuild,
  modelFallback: boolean,
) {
  const researchBundles = output.researchBundles ?? [];
  const portfolioData = portfolio.marketResults
    .map((result) => result.pandadata)
    .filter((result): result is PandadataProbe => Boolean(result));
  const combinedData = [...output.dataResults, ...portfolioData];
  const status = enforceStatus(output.decision, combinedData);
  const reasons = degradationReasons(output.decision, combinedData, modelFallback);
  const action = status === "BLOCKED" ? "WATCH" : output.decision.action;
  const primaryInstrument = output.decision.primaryInstrument?.symbol
    ? store.profile.getInstrument(output.decision.primaryInstrument.symbol)
    : null;
  const agentTrace = output.findings.map((finding) => ({
    agent: finding.role as AdvisorAgentRole,
    summary: finding.summary,
  }));

  return store.saveRecommendation({
    analysisId,
    conversationId,
    action,
    status,
    summary: recommendationSummary(output.decision, status, reasons),
    suitability: status === "ACTIVE" ? output.decision.suitability : "LOW",
    confidence: status === "ACTIVE" ? output.decision.confidence : "LOW",
    rationales: output.decision.rationales,
    counterEvidence: output.decision.counterEvidence,
    risks: output.decision.risks,
    validUntil: output.decision.validUntil || validUntil(),
    sourceSummary: `${output.decision.sourceSummary} | ${dataSummary(combinedData)}`,
    userId: DEMO_USER_ID,
    portfolioSnapshotId: portfolio.snapshotId,
    instrumentId: primaryInstrument?.id,
    suggestedAllocationRange: output.decision.suggestedAllocationRange,
    firstEntryAllocation: output.decision.firstEntryAllocation,
    addConditions: output.decision.addConditions,
    referenceRange: output.decision.referenceRange,
    stopLoss: output.decision.stopLoss,
    takeProfit: output.decision.takeProfit,
    horizon: output.decision.horizon,
    executionPace: output.decision.executionPace,
    sellDownRatio: output.decision.sellDownRatio,
    triggerReasons: output.decision.triggerReasons,
    portfolioImpact: `${output.decision.portfolioImpact} ${summarizePortfolioImpact(portfolio.diagnostic)}`,
    alternatives: output.decision.alternatives,
    invalidationConditions: output.decision.invalidationConditions,
    agentTrace,
    stockResearch: researchBundles.map(toStockResearchCard),
    degradationReasons: reasons,
    runtimeMode: modelFallback ? "DETERMINISTIC_FALLBACK" : "MULTI_AGENT",
  });
}

function validUntil() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString();
}

function dataSummary(dataResults: PandadataProbe[]) {
  if (dataResults.length === 0) return "pandadata:no live call attempted";
  return dataResults.map((result) => [
    `pandadata:${result.method}`,
    `contract=${result.contractValidated}`,
    `runtime=${result.runtimeConfigured}`,
    `live=${result.liveCallSucceeded}`,
    `fresh=${result.liveDataFresh}`,
  ].join(",")).join(" | ");
}

function enforceStatus(decision: AdvisorDecision, dataResults: PandadataProbe[]): RecommendationStatus {
  const hasLiveFreshData = dataResults.some(hasActionablePandadata);
  if (decision.status === "BLOCKED" || decision.compliance.decision === "BLOCKED") return "BLOCKED";
  if (decision.status === "ACTIVE" && decision.compliance.approved && hasLiveFreshData) return "ACTIVE";
  return "DEGRADED";
}

function degradationReasons(
  decision: AdvisorDecision,
  dataResults: PandadataProbe[],
  modelFallback: boolean,
): DegradationReason[] {
  if (decision.status === "BLOCKED" || decision.compliance.decision === "BLOCKED") return [];
  const reasons = new Set<DegradationReason>();
  if (modelFallback) reasons.add("MODEL_UNAVAILABLE");
  if (!dataResults.some(hasActionablePandadata)) {
    reasons.add(dataResults.some((result) => result.liveCallSucceeded && !result.liveDataFresh)
      ? "PANDADATA_STALE"
      : "PANDADATA_UNAVAILABLE");
  }
  if (!modelFallback && (decision.compliance.decision === "DOWNGRADED" || !decision.compliance.approved)) {
    reasons.add("COMPLIANCE_DOWNGRADED");
  }
  if (decision.status === "DEGRADED" && reasons.size === 0) reasons.add("ADVICE_DEGRADED");
  return [...reasons];
}

function recommendationSummary(
  decision: AdvisorDecision,
  status: RecommendationStatus,
  reasons: DegradationReason[],
) {
  if (status === "ACTIVE") return decision.summary;
  if (status === "BLOCKED") return `${decision.summary} 当前被合规或数据条件阻断，不能生成可执行建议。`;
  const explanation = reasons.map((reason) => {
    if (reason === "MODEL_UNAVAILABLE") return "模型服务不可用，已切换到结构化降级分析";
    if (reason === "PANDADATA_STALE") return "PandaData 返回的数据已过期";
    if (reason === "PANDADATA_UNAVAILABLE") return "PandaData 实时数据不可用";
    if (reason === "COMPLIANCE_DOWNGRADED") return `合规检查未批准执行：${decision.compliance.reason}`;
    return "建议证据尚不足以升级为可执行状态";
  }).join("；");
  const reasonText = explanation ? `原因：${explanation}。` : "原因：建议证据不完整。";
  return `${decision.summary} ${reasonText}当前仅允许模拟，不可实际下单。`;
}

function summarizePortfolioImpact(diagnostic: Record<string, unknown>) {
  const concentration = diagnostic.concentration as {
    largestSectorWeight?: number;
    largestPositionWeight?: number;
  } | undefined;
  if (!concentration) return "";
  return `当前最大单项权重约 ${Math.round((concentration.largestPositionWeight ?? 0) * 100)}%，最大主题/行业权重约 ${Math.round((concentration.largestSectorWeight ?? 0) * 100)}%。`;
}
