import { createId } from "@/server/http/context";

export interface HoldingParseInstrument {
  id: string;
  symbol: string;
  name: string;
  market: string;
  asset_type: string;
  tradable: number;
}

export interface HoldingParseCandidate {
  candidateId: string;
  instrumentId: string | null;
  assetType: string | null;
  symbol: string | null;
  name: string;
  market: string | null;
  quantity: string | null;
  averageCost: string | null;
  cost: string | null;
  confidence: number;
  issues: Array<{ code: string; message: string }>;
  suggestedMatches: Array<{ instrumentId: string; assetType: string; symbol: string; name: string; market: string }>;
}

export function parseHoldingText(text: string, instruments: HoldingParseInstrument[]): HoldingParseCandidate[] {
  const quantity = extractQuantity(text);
  const averageCost = extractAverageCost(text);
  const normalized = text.toLocaleLowerCase();
  const directMatches = instruments.filter((instrument) => {
    const symbolPattern = new RegExp(`(^|[^a-z0-9.])${escapeRegExp(instrument.symbol.toLocaleLowerCase())}([^a-z0-9.]|$)`, "u");
    return symbolPattern.test(normalized) || normalized.includes(instrument.name.toLocaleLowerCase());
  });
  const inferredMatches = directMatches.length ? directMatches : inferNamedIndex(text, instruments);
  const uniqueMatches = [...new Map(inferredMatches.map((instrument) => [instrument.id, instrument])).values()];
  return uniqueMatches.map((instrument) => {
    const issues: HoldingParseCandidate["issues"] = [];
    if (!instrument.tradable || instrument.asset_type.toLowerCase() === "index") issues.push({ code: "DIRECT_INDEX_NOT_TRADABLE", message: "指数本身通常不能按股买入，请确认实际交易产品" });
    if (!quantity) issues.push({ code: "QUANTITY_MISSING", message: "未识别到持仓数量" });
    if (!averageCost) issues.push({ code: "AVERAGE_COST_MISSING", message: "未识别到平均成本" });
    const suggestedMatches = issues.some((issue) => issue.code === "DIRECT_INDEX_NOT_TRADABLE")
      ? findSuggestedMatches(instrument, instruments)
      : [];
    return {
      candidateId: createId("candidate"),
      instrumentId: instrument.tradable ? instrument.id : null,
      assetType: instrument.asset_type || null,
      symbol: instrument.symbol || null,
      name: instrument.name,
      market: instrument.market || null,
      quantity,
      averageCost,
      cost: averageCost,
      confidence: issues.length ? 0.68 : 0.96,
      issues,
      suggestedMatches,
    };
  });
}

function extractQuantity(text: string): string | null {
  const patterns = [
    /(?:买入|买了|持有|购入|现有|有)\s*(\d+(?:\.\d+)?)\s*(?:股|份|手)?/iu,
    /(\d+(?:\.\d+)?)\s*(?:股|份|手)/iu,
  ];
  return firstPositiveMatch(text, patterns);
}

function extractAverageCost(text: string): string | null {
  const patterns = [
    /(?:成本|均价|买入价|价格)\s*(?:是|为|:|：)?\s*(\d+(?:\.\d+)?)/iu,
    /(\d+(?:\.\d+)?)\s*(?:元|点)?\s*时\s*(?:买|购)/iu,
    /(?:以|在)\s*(\d+(?:\.\d+)?)\s*(?:元|点)?(?:的价格)?\s*(?:买|购)/iu,
  ];
  return firstPositiveMatch(text, patterns);
}

function firstPositiveMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const value = pattern.exec(text)?.[1];
    if (value && Number(value) > 0) return value;
  }
  return null;
}

function inferNamedIndex(text: string, instruments: HoldingParseInstrument[]): HoldingParseInstrument[] {
  const aliases = ["沪深300", "中证500", "上证50", "标普500", "纳斯达克100"];
  const alias = aliases.find((value) => text.includes(value));
  if (!alias) return [];
  const matches = instruments.filter((instrument) => instrument.name.includes(alias));
  const directIndex = matches.find((instrument) => !instrument.tradable || instrument.asset_type.toLowerCase() === "index");
  return directIndex ? [directIndex] : matches.slice(0, 1);
}

function findSuggestedMatches(source: HoldingParseInstrument, instruments: HoldingParseInstrument[]) {
  const root = source.name.replace(/示例|指数|ETF|基金/giu, "").trim();
  return instruments
    .filter((instrument) => instrument.tradable && instrument.id !== source.id && (instrument.name.includes(root) || root.includes(instrument.name.replace(/示例|指数|ETF|基金/giu, "").trim())))
    .slice(0, 5)
    .map((instrument) => ({ instrumentId: instrument.id, assetType: instrument.asset_type, symbol: instrument.symbol, name: instrument.name, market: instrument.market }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
