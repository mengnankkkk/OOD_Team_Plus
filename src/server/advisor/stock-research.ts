import { calculateTechnical, normalizePrices } from "@/server/advisor/analytics";
import { compactDate, currentDateIso, dateDaysAgo } from "@/server/advisor/date-utils";
import { fixtureMarketSeries, fixtureResearchMetrics } from "@/server/advisor/fixture-market";
import { hasActionablePandadata, PandadataAdapter, type PandadataProbe } from "@/server/advisor/pandadata";
import {
  eventRows,
  latestIndustry,
  latestProbeValue,
  latestValue,
  mergeFundamentals,
  mergeValuation,
  newestProbeDate,
  normalizeMarket,
  numberValue,
  paramsFor,
  rowsFor,
} from "@/server/advisor/stock-research-support";

export type StockResearchBundle = {
  symbol: string;
  name: string;
  exchange: string;
  source: "pandadata" | "mixed" | "local_fixture";
  dataQuality: "HIGH" | "MEDIUM" | "LOW";
  dataAsOf: string;
  methods: string[];
  unavailableMethods: string[];
  market: { lastPrice: string | null; changeRate: number | null; technical: Record<string, unknown> };
  valuation: Record<string, unknown>;
  fundamentals: Record<string, unknown>;
  industry: Record<string, unknown>;
  events: Array<Record<string, unknown>>;
  capitalAndFactors: Record<string, unknown>;
  coverage: { requested: number; live: number; unavailable: number; liveMethods: string[] };
  supportEvidence: string[];
  counterEvidence: string[];
  probes: PandadataProbe[];
};

type StockResearchInput = {
  symbol: string;
  name?: string;
  market?: string;
  assetType?: string;
  startDate?: string;
  endDate?: string;
  methods?: string[];
};

export type StockResearchAdapter = Pick<PandadataAdapter, "fetch">;

const researchMethodsByMarket: Record<string, readonly string[]> = {
  CN: [
    "get_stock_daily_pre", "get_stock_rt_daily", "get_stock_detail", "get_stock_industry",
    "get_fina_performance", "get_fina_forecast", "get_fina_reports", "get_audit_opinion",
    "get_stock_status_change", "get_restricted_list", "get_stock_pledge",
    "get_stock_shareholder_change", "get_repurchase", "get_stock_dividend", "get_holder_count",
    "get_margin", "get_lhb_list", "get_factor", "get_adj_factor",
  ],
  HK: [
    "get_hk_daily", "get_hk_detail", "get_stock_pv_indicator", "get_stock_mktfin_indicator",
    "get_stock_industry_median", "get_stock_dividend_event", "get_stock_market_event",
    "get_stock_financial_event", "get_stock_ir_event", "get_stock_investor_concentration",
    "get_stock_insider_trade", "get_stock_shareholder_holding", "get_factor", "get_adj_factor",
  ],
  US: [
    "get_us_daily", "get_us_detail", "get_stock_pv_metric", "get_stock_mktfin_metric",
    "get_stock_sector_median", "get_stock_dividend_activity", "get_stock_market_activity",
    "get_stock_financial_activity", "get_stock_ir_activity", "get_stock_investor_centralization",
    "get_stock_insider_transaction", "get_stock_shareholder_report", "get_factor", "get_adj_factor",
  ],
};

export class StockResearchService {
  constructor(private readonly adapter: StockResearchAdapter = new PandadataAdapter()) {}

  async research(input: StockResearchInput): Promise<StockResearchBundle> {
    const market = normalizeMarket(input.market);
    const methods = input.methods?.length
      ? input.methods
      : defaultMethods(market, input.assetType);
    const window = {
      start_date: input.startDate ?? compactDate(dateDaysAgo(365)),
      end_date: input.endDate ?? compactDate(),
    };
    const probes = await Promise.all(methods.map((method) => this.adapter.fetch(method, paramsFor(method, input.symbol, window, market))));
    const live = probes.filter((probe) => hasActionablePandadata(probe) && (probe.data?.length ?? 0) > 0);
    const fallback = fixtureResearchMetrics(input.symbol);
    const priceRows = rowsFor(probes, [
      "get_stock_daily_pre", "get_stock_rt_daily", "get_hk_daily", "get_us_daily",
      "get_fund_daily", "get_fund_daily_pre", "get_fund_daily_post",
    ]);
    const prices = normalizePrices(priceRows.length ? priceRows : fixtureMarketSeries(input.symbol));
    const technical = calculateTechnical(prices);
    const fundamentals = mergeFundamentals(probes, fallback);
    const valuation = mergeValuation(probes, fallback, latestValue(priceRows, ["close", "close_price", "price"]), fundamentals);
    const events = eventRows(probes);
    const industry = latestIndustry(probes, market);
    const lastPrice = String(latestValue(priceRows, ["close", "close_price", "price"]) ?? latestProbeValue(probes, ["pv_close", "close"]) ?? fallback.price);
    const source = live.length === 0 ? "local_fixture" : live.length === probes.length ? "pandadata" : "mixed";
    return {
      symbol: input.symbol,
      name: input.name ?? String(latestProbeValue(probes, ["name"]) ?? input.symbol),
      exchange: market,
      source,
      dataQuality: researchDataQuality(live.length, probes.length),
      dataAsOf: newestProbeDate(probes) ?? currentDateIso(),
      methods,
      unavailableMethods: probes.filter((probe) => !hasActionablePandadata(probe)).map((probe) => probe.method),
      market: {
        lastPrice,
        changeRate: numberValue(latestValue(priceRows, ["change_rate", "pct_chg", "changeRate"]) ?? latestProbeValue(probes, ["pv_return_1d", "return_1d"])),
        technical: { ...technical, weeklyAlignment: fallback.weeklyAlignment, volumeConfirmation: fallback.volumeConfirmation },
      },
      valuation: { ...valuation, industryPeMedian: fallback.industryPeMedian ?? null },
      fundamentals,
      industry,
      events,
      capitalAndFactors: {
        margin: latestRow(probes, "get_margin"),
        lhb: latestRow(probes, "get_lhb_list"),
        factor: latestRow(probes, "get_factor"),
        shareholderCount: latestRow(probes, "get_holder_count"),
        pledge: latestRow(probes, "get_stock_pledge"),
      },
      coverage: {
        requested: probes.length,
        live: live.length,
        unavailable: probes.length - live.length,
        liveMethods: live.map((probe) => probe.method),
      },
      supportEvidence: buildSupportEvidence(source, valuation, fundamentals, technical, events),
      counterEvidence: buildCounterEvidence(source, valuation, fundamentals, technical, events),
      probes,
    };
  }
}

function defaultMethods(market: string, assetType?: string) {
  if (["ETF", "GOLD_ETF", "INDEX_FUND"].includes(String(assetType).toUpperCase())) {
    return ["get_fund_detail", "get_fund_daily"];
  }
  return [...(researchMethodsByMarket[market] ?? researchMethodsByMarket.CN)];
}

function latestRow(probes: PandadataProbe[], method: string) {
  const probe = probes.find((item) => item.method === method && hasActionablePandadata(item));
  return probe?.data?.at(-1) ?? null;
}

function buildSupportEvidence(
  source: string,
  valuation: Record<string, unknown>,
  fundamentals: Record<string, unknown>,
  technical: Record<string, unknown>,
  events: Array<Record<string, unknown>>,
) {
  const items = [`研究来源：${source}`];
  const pePercentile = numberValue(valuation.peThreeYearPercentile);
  const netProfitYoY = numberValue(fundamentals.netProfitYoY);
  if (pePercentile != null && pePercentile < 0.4) items.push("估值历史分位偏低，具备观察价值。");
  if (netProfitYoY != null && netProfitYoY > 0) items.push("净利润同比为正，基本面没有出现明显恶化。");
  if (String(technical.macdState).includes("GOLDEN")) items.push("技术面出现日线 MACD 金叉，但仍需结合更高周期确认。");
  if (events.length === 0) items.push("当前研究窗口未发现已返回的重大公司行为事件。");
  return items.slice(0, 3);
}

function buildCounterEvidence(
  source: string,
  valuation: Record<string, unknown>,
  fundamentals: Record<string, unknown>,
  technical: Record<string, unknown>,
  events: Array<Record<string, unknown>>,
) {
  const items = [];
  const pePercentile = numberValue(valuation.peThreeYearPercentile);
  const netProfitYoY = numberValue(fundamentals.netProfitYoY);
  if (source !== "pandadata") items.push("核心数据未全部来自新鲜 PandaData，不能升级为强执行建议。");
  if (pePercentile != null && pePercentile > 0.6) items.push("估值历史分位偏高，追高的安全边际较弱。");
  if (netProfitYoY != null && netProfitYoY < 0) items.push("净利润同比为负，基本面兑现仍需验证。");
  if (String(technical.ma60Relation) === "BELOW") items.push("价格仍低于中期均线，趋势证据并不一致。");
  if (events.length > 0) items.push("存在公司行为或股东事件，需要核对影响是否已反映在价格中。");
  return items.slice(0, 3).length ? items.slice(0, 3) : ["单一指标不能独立触发买卖建议。"];
}

function researchDataQuality(liveCount: number, requestedCount: number) {
  if (liveCount >= 8 || (requestedCount >= 4 && liveCount === requestedCount)) return "HIGH";
  if (liveCount >= 3 || (requestedCount > 0 && liveCount === requestedCount)) return "MEDIUM";
  return "LOW";
}
