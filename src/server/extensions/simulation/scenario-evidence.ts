import type { BranchScenarioOption } from "./scenario-contracts";

export type ScenarioResearchRecord = {
  instrumentId?: string;
  symbol?: string;
  source?: string;
  method?: string;
  fresh?: boolean;
  asOfDate?: string | null;
  sampleCount?: number;
  latestClose?: string;
  periodStartClose?: string;
  periodReturn?: string;
  periodHigh?: string;
  periodLow?: string;
  dataStatus?: string;
};

export type ScenarioEvidenceDraft = {
  strategy?: BranchScenarioOption["strategy"];
  trades?: BranchScenarioOption["trades"];
  rationale?: string[];
  counterEvidence?: string[];
  risks?: string[];
  assumptions?: string[];
  invalidationConditions?: string[];
};

export type ScenarioEvidenceContext = {
  objective: string;
  research: Array<Record<string, unknown> | ScenarioResearchRecord>;
  holdings: Array<Record<string, unknown>>;
  riskConstraints?: Record<string, unknown>;
};

export type ScenarioEvidenceMetrics = {
  concentrationHhi?: number;
  bearCaseReturn?: number;
};

const STATIC_EVIDENCE = new Set([
  "基于当前分支上下文生成的模型候选",
  "市场变化可能使当前方案失效",
  "候选结果仅用于模拟，不代表未来收益",
]);

export function completeScenarioEvidence(
  option: ScenarioEvidenceDraft,
  context: ScenarioEvidenceContext,
  metrics: ScenarioEvidenceMetrics = {},
): Required<Pick<ScenarioEvidenceDraft, "rationale" | "counterEvidence" | "risks" | "assumptions" | "invalidationConditions">> {
  const research = normalizeResearch(context.research);
  const facts = researchFacts(research);
  const portfolio = portfolioFact(context.holdings);
  const action = tradeFact(option.trades);
  const marketFact = facts[0] ?? unavailableFact(research);
  const freshness = freshnessFact(research);
  const pressure = pressureFact(metrics.bearCaseReturn);

  return {
    rationale: usable(option.rationale, 3, research) ?? [
      `${action}，围绕目标“${context.objective}”；${marketFact}`,
      portfolio ?? "当前组合没有可用于计算集中度的市值记录",
      pressure ?? freshness,
    ],
    counterEvidence: usable(option.counterEvidence, 3, research) ?? [
      counterFact(research, marketFact),
      portfolio ? `如果最大持仓继续沿原方向变化，组合集中度仍可能偏离当前方案目标（${portfolio}）` : freshness,
    ],
    risks: usable(option.risks, 3, research) ?? [
      portfolio ?? "当前组合缺少市值记录，无法从集中度角度完整评估风险",
      freshness,
      pressure ?? `数据源研究项为 ${research.length} 条，需关注数据覆盖是否足以支持本轮比较`,
    ],
    assumptions: usable(option.assumptions, 8) ?? [
      freshness,
      "成交数量由服务端冻结价格和当前持仓约束校验",
      metrics.concentrationHhi == null ? "组合 HHI 尚未形成可比基线" : `模拟后组合 HHI 为 ${metrics.concentrationHhi.toFixed(4)}`,
    ],
    invalidationConditions: usable(option.invalidationConditions, 6) ?? [
      invalidationFact(research),
      "如果风险预算或资金用途发生变化，本轮候选需要重新生成",
    ],
  };
}

function normalizeResearch(
  records: Array<Record<string, unknown> | ScenarioResearchRecord>,
): ScenarioResearchRecord[] {
  return records
    .map((record) => ({
      instrumentId: text(record.instrumentId),
      symbol: text(record.symbol),
      source: text(record.source),
      method: text(record.method),
      fresh: typeof record.fresh === "boolean" ? record.fresh : undefined,
      asOfDate: text(record.asOfDate) ?? null,
      sampleCount: numberValue(record.sampleCount),
      latestClose: text(record.latestClose),
      periodStartClose: text(record.periodStartClose),
      periodReturn: text(record.periodReturn),
      periodHigh: text(record.periodHigh),
      periodLow: text(record.periodLow),
      dataStatus: text(record.dataStatus),
    }))
    .filter((record) => record.symbol || record.instrumentId || record.dataStatus);
}

function researchFacts(records: ScenarioResearchRecord[]): string[] {
  return records
    .filter((record) => record.symbol && record.latestClose && record.periodReturn)
    .slice(0, 3)
    .map((record) => {
      const change = signedPercent(record.periodReturn!);
      const sample = record.sampleCount ? `${record.sampleCount} 个交易日` : "可用交易日样本";
      const date = record.asOfDate ?? "最近可用日期未知";
      const source = record.source ?? record.method ?? "市场数据源";
      return `${record.symbol} 的 ${source} 提供了 ${sample}，收盘价由 ${record.periodStartClose ?? "未知"} 变为 ${record.latestClose}，区间${change}，最新数据截至 ${date}`;
    });
}

function portfolioFact(holdings: Array<Record<string, unknown>>): string | null {
  const rows = holdings
    .map((holding) => ({
      symbol: text(holding.symbol) ?? text(holding.instrument_id) ?? text(holding.instrumentId) ?? "未知标的",
      marketValue: numberValue(holding.market_value_decimal ?? holding.marketValue),
    }))
    .filter((row): row is { symbol: string; marketValue: number } => row.marketValue != null && row.marketValue > 0);
  const total = rows.reduce((sum, row) => sum + row.marketValue, 0);
  const largest = rows.sort((left, right) => right.marketValue - left.marketValue)[0];
  if (!largest || total <= 0) return null;
  return `当前最大持仓 ${largest.symbol} 市值约占组合 ${(largest.marketValue / total * 100).toFixed(1)}%`;
}

function tradeFact(trades: BranchScenarioOption["trades"] | undefined): string {
  if (!trades?.length) return "本方案不产生模拟交易，作为当前组合基准";
  const actions = trades.map((trade) => `${trade.action === "BUY" ? "买入" : "卖出"} ${trade.instrumentId} ${trade.quantity} 单位`);
  return `本方案计划${actions.join("、")}`;
}

function counterFact(records: ScenarioResearchRecord[], fallback: string): string {
  const record = records.find((item) => item.symbol && item.periodReturn && item.latestClose);
  if (!record?.symbol || !record.periodReturn) return `当前研究数据不足以验证近期走势，${fallback}`;
  const direction = Number(record.periodReturn) >= 0 ? "上涨" : "下跌";
  const opposite = direction === "上涨" ? "回撤" : "反弹";
  return `如果 ${record.symbol} 从近期开盘到最新收盘的${direction}趋势出现${opposite}，本方案的相对表现可能与当前比较不同（区间变化 ${signedPercent(record.periodReturn)}，数据截至 ${record.asOfDate ?? "未知日期"}）`;
}

function freshnessFact(records: ScenarioResearchRecord[]): string {
  const stale = records.filter((record) => record.fresh === false);
  const unavailable = records.filter((record) => record.dataStatus && record.dataStatus !== "VALID");
  if (unavailable.length) return `数据源有 ${unavailable.length} 个研究项未返回有效序列，本轮结论对这些标的保持保守`;
  if (stale.length) return `${stale.length} 个研究项不是最新数据，最近可用日期为 ${stale.map((record) => record.asOfDate ?? "未知").filter(Boolean).join("、") || "未知"}`;
  if (!records.length) return "本轮没有获得可用市场研究序列，结论不能代表近期行情判断";
  return `本轮使用 ${records.length} 个数据源研究项，最新可用日期为 ${records.map((record) => record.asOfDate).filter((value): value is string => Boolean(value)).sort().at(-1) ?? "未知"}`;
}

function pressureFact(value: number | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `内置压力场景下组合变动约为 ${signedPercent(String(value))}，该数值用于比较候选，不是发生概率`;
}

function invalidationFact(records: ScenarioResearchRecord[]): string {
  const record = records.find((item) => item.symbol && item.periodHigh && item.periodLow);
  if (!record?.symbol) return "如果数据源继续缺少有效行情序列，本轮证据覆盖不足，需要重新研究";
  return `如果 ${record.symbol} 突破当前研究区间 ${record.periodLow} 至 ${record.periodHigh}，本轮候选的行情依据需要重新评估`;
}

function usable(value: string[] | undefined, limit: number, research: ScenarioResearchRecord[] = []): string[] | undefined {
  const items = (value ?? [])
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && !STATIC_EVIDENCE.has(item))
    .slice(0, limit);
  if (!items.length) return undefined;
  if (!research.length) return items.filter((item) => /数据|研究|行情|缺少|未返回/u.test(item)).length ? items : undefined;
  const tokens = research.flatMap((record) => [record.symbol, record.asOfDate, record.latestClose, record.periodReturn].filter((value): value is string => Boolean(value)));
  const grounded = items.filter((item) => /\d/u.test(item) || /数据|研究|行情|区间|持仓|组合/u.test(item) || tokens.some((token) => item.includes(token)));
  return grounded.length ? grounded : undefined;
}

function unavailableFact(records: ScenarioResearchRecord[]): string {
  return records.length
    ? `研究数据返回 ${records.length} 条，但没有形成可比较的收盘价区间`
    : "当前分支没有可用的市场研究记录";
}

function signedPercent(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return `${numeric >= 0 ? "上涨" : "下跌"} ${Math.abs(numeric).toFixed(2)}%`;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const result = String(value).trim();
  return result || undefined;
}

function numberValue(value: unknown): number | undefined {
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}
