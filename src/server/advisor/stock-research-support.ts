import { fixtureResearchMetrics } from "@/server/advisor/fixture-market";
import { hasActionablePandadata, type PandadataProbe } from "@/server/advisor/pandadata";
import { latestRows } from "@/server/advisor/pandadata-runtime";
import { quartersAgo } from "@/server/advisor/date-utils";

export function paramsFor(
  method: string,
  symbol: string,
  window: { start_date: string; end_date: string },
  market: string,
) {
  if (method === "get_fund_detail") return { symbol, fields: [] };
  if (method === "get_fund_daily" || method === "get_fund_daily_pre" || method === "get_fund_daily_post") {
    return { symbol, ...window, fields: [] };
  }
  if (method === "get_stock_industry") return { stock_symbol: symbol, level: "L1" };
  if (method === "get_stock_detail") return { symbol: [symbol], fields: [], status: 1 };
  if (method === "get_hk_detail" || method === "get_us_detail") return { symbol: [symbol], fields: [] };
  if (method === "get_stock_rt_daily") return { symbol, fields: [] };
  if (method === "get_stock_daily_pre") return { symbol: [symbol], ...window, fields: [], indicator: "", st: true };
  if (method === "get_hk_daily" || method === "get_us_daily") return { symbol: [symbol], ...window, fields: [] };
  if (method === "get_fina_reports") {
    return { symbol, ...quarterWindow(window.end_date), date: window.end_date, is_latest: true, fields: [] };
  }
  if (method === "get_fina_performance" || method === "get_fina_forecast") {
    return { symbol, fields: [], end_quarter: quarterWindow(window.end_date).end_quarter };
  }
  if (method === "get_audit_opinion") {
    return { symbol, ...quarterWindow(window.end_date), market: market.toLowerCase(), fields: [] };
  }
  if (method === "get_restricted_list") return { symbol, ...window, fields: [], market: market.toLowerCase() };
  if (method === "get_stock_pledge" || method === "get_stock_shareholder_change") return { symbol, ...window, fields: [] };
  if (method === "get_stock_status_change") return { symbol, ...window, fields: [] };
  if (method === "get_margin") return { symbol, ...window, margin_type: "cash", fields: [] };
  if (method === "get_lhb_list") return { symbol, ...window, type: "", fields: [] };
  if (method === "get_factor") return { symbol, ...window, factors: ["open", "close", "market_cap", "turnover"], type: "stock", index_component: "" };
  if (method === "get_adj_factor") return { symbol, ...window, fields: [] };
  if (method === "get_stock_pv_indicator" || method === "get_stock_pv_metric") return { symbol: [symbol], fields: [] };
  if (method === "get_stock_mktfin_indicator" || method === "get_stock_mktfin_metric") return { symbol: [symbol], fields: [] };
  if (method.includes("_event") || method.includes("_activity")) return { symbol, ...window, fields: [] };
  return { symbol, ...window, fields: [] };
}

function quarterWindow(endDate: string) {
  const parsed = /^\d{8}$/.test(endDate)
    ? new Date(`${endDate.slice(0, 4)}-${endDate.slice(4, 6)}-${endDate.slice(6, 8)}T00:00:00Z`)
    : new Date(endDate);
  const safeDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return {
    start_quarter: quartersAgo(8, safeDate),
    end_quarter: `${safeDate.getUTCFullYear()}q${Math.floor(safeDate.getUTCMonth() / 3) + 1}`,
  };
}

export function rowsFor(probes: PandadataProbe[], methods: string[]) {
  return probes.filter((probe) => methods.includes(probe.method) && hasActionablePandadata(probe)).flatMap((probe) => probe.data ?? []);
}

export function latestRow(probes: PandadataProbe[], method: string) {
  const probe = probes.find((item) => item.method === method && hasActionablePandadata(item));
  return probe?.data?.at(-1) ?? null;
}

export function latestValue(rows: Array<Record<string, unknown>>, keys: string[]) {
  const row = latestRows(rows, 1).at(-1);
  if (!row) return null;
  for (const key of keys) if (row[key] != null) return row[key];
  return null;
}

export function latestProbeValue(probes: PandadataProbe[], keys: string[]) {
  return latestValue(
    probes.filter((probe) => hasActionablePandadata(probe)).flatMap((probe) => probe.data ?? []),
    keys,
  );
}

export function mergeValuation(
  probes: PandadataProbe[],
  fallback: ReturnType<typeof fixtureResearchMetrics>,
  latestPrice: unknown,
  fundamentals: Record<string, unknown>,
) {
  const row =
    latestRow(probes, "get_stock_mktfin_indicator") ??
    latestRow(probes, "get_stock_mktfin_metric") ??
    latestRow(probes, "get_stock_pv_indicator") ??
    latestRow(probes, "get_stock_pv_metric") ??
    {};
  const price = numberValue(latestPrice);
  const report = fundamentals.latestReport as Record<string, unknown> | undefined;
  const eps = numberValue(report?.basic_eps);
  const bvps = numberValue(report?.bvps);
  const derivedPe = price != null && eps != null && eps > 0 ? price / eps : null;
  const derivedPb = price != null && bvps != null && bvps > 0 ? price / bvps : null;
  const pe = firstNumber(row.curr_pe_dil_excl_ttm, row.curr_pe_basic_excl_ttm, row.pe_ttm, row.pe_lf, derivedPe, fallback.peTtm);
  const pb = firstNumber(row.curr_pb, row.curr_pb_lfy, row.pb_ttm, row.pb_lf, derivedPb);
  const ps = firstNumber(row.curr_ev_to_rev_ttm, row.ps_ttm, row.ps_lf);
  const dividendYield = firstNumber(row.curr_div_yld_gross_issue_ratio_ttm, row.curr_div_yld_issue_ratio_ttm, row.dividend_yield);
  return {
    peTtm: pe == null ? null : roundMetric(pe),
    pb: pb == null ? null : roundMetric(pb),
    ps: ps == null ? null : roundMetric(ps),
    peThreeYearPercentile: firstNumber(row.curr_rel_pe_dil_excl_ratio, row.pe_percentile, row.pe_ttm_percentile, fallback.pePercentile),
    dividendYield,
    peMeaningful: pe != null && pe > 0,
    valuationBasis: derivedPe != null && row.curr_pe_dil_excl_ttm == null ? "derived_from_price_and_eps" : "pandadata_metric",
  };
}

export function mergeFundamentals(probes: PandadataProbe[], fallback: ReturnType<typeof fixtureResearchMetrics>) {
  const row = latestRow(probes, "get_fina_performance") ?? latestRow(probes, "get_fina_reports") ?? {};
  return {
    revenueYoY: numberValue(row.operating_revenue_yoy ?? fallback.revenueYoY),
    netProfitYoY: numberValue(row.net_profit_parent_yoy ?? row.net_profit_excluding_nonrecurring_yoy ?? fallback.netProfitYoY),
    roe: numberValue(row.roe_weighted ?? row.roe_diluted ?? fallback.roe),
    operatingCashFlowToNetProfit: numberValue(row.net_cash_flow_operating ?? null),
    grossMarginTrend: row.gross_profit_yoy != null && Number(row.gross_profit_yoy) < 0 ? "DECLINING" : "STABLE",
    latestReport: row,
    auditOpinion: latestRow(probes, "get_audit_opinion"),
    earningsForecast: latestRow(probes, "get_fina_forecast"),
  };
}

export function eventRows(probes: PandadataProbe[]) {
  const methods = [
    "get_stock_status_change", "get_restricted_list", "get_stock_pledge",
    "get_stock_shareholder_change", "get_repurchase", "get_stock_dividend",
    "get_stock_dividend_event", "get_stock_dividend_activity", "get_stock_market_event",
    "get_stock_market_activity", "get_stock_financial_event", "get_stock_financial_activity",
  ];
  return probes
    .filter((probe) => methods.includes(probe.method) && hasActionablePandadata(probe))
    .flatMap((probe) => (probe.data ?? []).slice(-5).map((row) => ({ sourceMethod: probe.method, ...row })));
}

export function newestProbeDate(probes: PandadataProbe[]) {
  const marketDates = probes
    .filter((probe) => /(daily|rt_|minute|min_|spot)/.test(probe.method))
    .map((probe) => probe.asOfDate)
    .filter((date): date is string => Boolean(date));
  const dates = marketDates.length
    ? marketDates
    : probes.map((probe) => probe.asOfDate).filter((date): date is string => Boolean(date));
  return dates.sort().at(-1);
}

export function normalizeMarket(market: string | undefined) {
  const value = String(market ?? "CN").toUpperCase();
  return value === "HK" || value === "US" ? value : "CN";
}

export function latestIndustry(probes: PandadataProbe[], market: string) {
  if (market === "CN") return latestRow(probes, "get_stock_industry") ?? { industryName: "未知行业" };
  return latestRow(probes, market === "HK" ? "get_stock_industry_median" : "get_stock_sector_median") ?? { industryName: "未知行业" };
}

export function numberValue(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = numberValue(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function roundMetric(value: number) {
  return Number(value.toFixed(4));
}
