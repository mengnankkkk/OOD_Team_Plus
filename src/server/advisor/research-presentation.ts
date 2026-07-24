import type { AdvisorAgentRuntimeOutput } from "@/server/advisor/agents";
import type { AdvisorStore } from "@/server/advisor/store";
import type { StockResearchCard } from "@/server/advisor/types";

export function emitResearchEvidence(
  store: AdvisorStore,
  analysisId: string,
  bundles: NonNullable<AdvisorAgentRuntimeOutput["researchBundles"]>,
) {
  for (const bundle of bundles) {
    const source = bundle.source === "local_fixture" ? "local_fixture" : "pandadata";
    for (const summary of bundle.supportEvidence) {
      store.addEvidence({ analysisId, stance: "support", kind: "market_fact", source, summary: `${bundle.symbol}：${summary}` });
    }
    for (const summary of bundle.counterEvidence) {
      store.addEvidence({ analysisId, stance: "counter", kind: "market_fact", source, summary: `${bundle.symbol}：${summary}` });
    }
    store.addEvidence({
      analysisId,
      stance: bundle.source === "local_fixture" ? "missing" : "neutral",
      kind: bundle.source === "local_fixture" ? "missing_data" : "market_fact",
      source,
      summary: `${bundle.symbol} 研究覆盖 ${bundle.coverage.live}/${bundle.coverage.requested} 个接口，数据截至 ${bundle.dataAsOf}。`,
    });
  }
}

export function toStockResearchCard(
  bundle: NonNullable<AdvisorAgentRuntimeOutput["researchBundles"]>[number],
): StockResearchCard {
  return {
    symbol: bundle.symbol,
    name: bundle.name,
    exchange: bundle.exchange,
    source: bundle.source,
    dataQuality: bundle.dataQuality,
    dataAsOf: bundle.dataAsOf,
    methods: bundle.methods,
    unavailableMethods: bundle.unavailableMethods,
    market: bundle.market,
    valuation: bundle.valuation,
    fundamentals: bundle.fundamentals,
    industry: bundle.industry,
    events: bundle.events,
    capitalAndFactors: bundle.capitalAndFactors,
    coverage: bundle.coverage,
    supportEvidence: bundle.supportEvidence,
    counterEvidence: bundle.counterEvidence,
  };
}
