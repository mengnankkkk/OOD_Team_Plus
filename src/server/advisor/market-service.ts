import type { AdvisorStore } from "@/server/advisor/store";
import { PandadataAdapter, hasActionablePandadata, type PandadataProbe } from "@/server/advisor/pandadata";
import type { InstrumentRecord } from "@/server/advisor/profile-store";
import { calculateTechnical, normalizePrices } from "@/server/advisor/analytics";
import { compactDate, currentDateStartIso, dateDaysAgo } from "@/server/advisor/date-utils";
import { fixtureMarketSeries, fixtureResearchMetrics } from "@/server/advisor/fixture-market";

export type MarketDataResult = {
  instrument: InstrumentRecord;
  source: "pandadata" | "local_fixture";
  pandadata: PandadataProbe | null;
  rows: Array<Record<string, unknown>>;
  metrics: Record<string, unknown>;
  snapshotId: string;
  dataAsOf: string;
  fresh: boolean;
};

type MarketDataAdapter = Pick<PandadataAdapter, "fetch">;

export class MarketDataService {
  constructor(
    private readonly store: AdvisorStore,
    private readonly adapter: MarketDataAdapter = new PandadataAdapter(),
  ) {}

  async getSnapshot(instrument: InstrumentRecord): Promise<MarketDataResult> {
    const params = buildParams(instrument);
    const method = methodForInstrument(instrument);
    const pandadata = await this.adapter.fetch(method, params);
    const live = Boolean(hasActionablePandadata(pandadata) && pandadata.data && pandadata.data.length > 0);
    const rows = live ? pandadata.data! : fixtureMarketSeries(instrument.symbol);
    const prices = normalizePrices(rows);
    const technical = calculateTechnical(prices);
    const research = fixtureResearchMetrics(instrument.symbol);
    const dataAsOf = live
      ? new Date(`${pandadata.asOfDate}T07:00:00.000Z`).toISOString()
      : currentDateStartIso();
    const metrics = {
      technical: { ...technical, ...macdContext(research, technical) },
      valuation: valuationMetrics(research),
      fundamentals: fundamentalMetrics(research),
      events: eventEvidence(research),
      pandadata: {
        method,
        contractValidated: pandadata.contractValidated,
        runtimeConfigured: pandadata.runtimeConfigured,
        liveCallSucceeded: pandadata.liveCallSucceeded,
        liveDataFresh: pandadata.liveDataFresh,
        summary: pandadata.summary,
      },
    };
    const snapshot = this.store.analysis.saveMarketSnapshot({
      instrumentId: instrument.id,
      sourceType: live ? "pandadata" : "local_fixture",
      sourceMethod: method,
      dataAsOf,
      freshUntil: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
      quality: live ? "valid" : "partial",
      rows: rows.length,
      data: rows.slice(-120),
      metrics,
    });
    return {
      instrument,
      source: live ? "pandadata" : "local_fixture",
      pandadata,
      rows,
      metrics,
      snapshotId: snapshot.id,
      dataAsOf,
      fresh: live,
    };
  }
}

function methodForInstrument(instrument: InstrumentRecord) {
  if (instrument.assetType === "ETF" || instrument.assetType === "GOLD_ETF") return "get_fund_daily";
  if (instrument.assetType === "INDEX") return "get_index_daily";
  return "get_stock_daily";
}

function buildParams(instrument: InstrumentRecord) {
  const symbol = instrument.symbol;
  return {
    symbol: [symbol],
    start_date: compactDate(dateDaysAgo(365)),
    end_date: compactDate(),
    fields: [],
  };
}

function valuationMetrics(research: ReturnType<typeof fixtureResearchMetrics>) {
  return {
    peTtm: research.peTtm == null ? null : research.peTtm.toFixed(2),
    peMeaningful: research.peTtm != null && research.peTtm > 0,
    peThreeYearPercentile: research.pePercentile ?? null,
    industryPeMedian: research.industryPeMedian?.toFixed(2) ?? null,
    pb: research.peTtm == null ? null : (research.peTtm / 8).toFixed(2),
    ps: research.peTtm == null ? null : (research.peTtm / 7).toFixed(2),
    dividendYield: research.peTtm == null ? null : 0.012,
  };
}

function fundamentalMetrics(research: ReturnType<typeof fixtureResearchMetrics>) {
  return {
    revenueYoY: research.revenueYoY ?? null,
    netProfitYoY: research.netProfitYoY ?? null,
    roe: research.roe ?? null,
    grossMarginTrend: research.netProfitYoY != null && research.netProfitYoY < 0 ? "DECLINING" : "STABLE",
    operatingCashFlowToNetProfit: research.netProfitYoY != null && research.netProfitYoY < 0 ? 0.8 : 1.1,
    debtRatio: 0.41,
  };
}

function macdContext(research: ReturnType<typeof fixtureResearchMetrics>, technical: Record<string, unknown>) {
  return {
    macdState: research.macdState || technical.macdState,
    macdZeroAxis: research.zeroAxis || technical.macdZeroAxis,
    weeklyAlignment: research.weeklyAlignment,
    volumeConfirmation: research.volumeConfirmation,
  };
}

function eventEvidence(research: ReturnType<typeof fixtureResearchMetrics>) {
  return research.event
    ? [{ title: research.event, sourceTier: "LOCAL_FIXTURE", direction: research.event.includes("风险") ? "NEGATIVE" : "NEUTRAL", materiality: "MEDIUM" }]
    : [];
}
