import type { InstrumentRecord } from "@/server/advisor/profile-store";
import type { AdvisorStore } from "@/server/advisor/store";

type ParseInput = {
  userId: string;
  text: string;
  defaultMarket?: string;
  conversationId?: string | null;
};

const INDEX_TERMS = ["沪深300", "中证500", "上证50", "创业板指", "科创50"];

export function parseHoldingText(store: AdvisorStore, input: ParseInput) {
  const normalized = input.text.trim();
  const instrument = resolveTextInstrument(store, normalized);
  const quantity = captureQuantity(normalized, instrument);
  const averageCost = captureAverageCost(normalized);
  const halfPosition = /半仓|一半仓位|五成仓位|50%/.test(normalized);
  const issues: Array<Record<string, string>> = [];
  const suggestedMatches = instrument ? [] : searchSuggestions(store, normalized);

  if (instrument && !instrument.tradable) {
    issues.push({
      code: "DIRECT_INDEX_NOT_TRADABLE",
      message: "指数本身通常不能按股买入，请确认实际 ETF、指数基金或期货产品。",
    });
  }
  if (!instrument) {
    issues.push({ code: "INSTRUMENT_AMBIGUOUS", message: "未能唯一确认标的，请选择代码和资产类型。" });
  }
  if (!quantity && halfPosition) {
    issues.push({ code: "POSITION_RATIO_WITHOUT_TOTAL", message: "只提供半仓，缺少组合总资产或具体数量。" });
  }
  if (!quantity && !halfPosition) {
    issues.push({ code: "QUANTITY_MISSING", message: "缺少持仓数量。" });
  }
  if (!averageCost) {
    issues.push({ code: "COST_MISSING", message: "缺少平均成本。" });
  }

  const candidate = {
    candidateId: "candidate_01",
    assetType: instrument?.tradable ? instrument.assetType : null,
    instrumentId: instrument?.tradable ? instrument.id : null,
    symbol: instrument?.tradable ? instrument.symbol : null,
    name: instrument?.name ?? guessedName(normalized),
    market: instrument?.market ?? input.defaultMarket ?? "CN",
    quantity: quantity?.value ?? (halfPosition ? null : undefined),
    averageCost: averageCost ?? null,
    costUnit: instrument && !instrument.tradable ? "INDEX_POINTS" : "CURRENCY_PER_UNIT",
    requiresTradableMapping: Boolean(instrument && !instrument.tradable),
    currency: "CNY",
    confidence: issues.length === 0 ? 0.88 : 0.62,
    issues,
    suggestedMatches: instrument && !instrument.tradable
      ? searchSuggestions(store, normalized)
      : suggestedMatches,
  };

  return store.holdings.createDraft(
    input.userId,
    input.conversationId ?? null,
    input.text,
    [candidate],
    issues.map((issue) => issue.code),
  );
}

function resolveTextInstrument(store: AdvisorStore, text: string) {
  const directSymbol = /([0-9]{6}\.(?:SH|SZ)|[0-9]{6})/i.exec(text)?.[1];
  if (directSymbol) {
    const normalizedSymbols = directSymbol.includes(".")
      ? [directSymbol.toUpperCase()]
      : [`${directSymbol}.SH`, `${directSymbol}.SZ`];
    for (const symbol of normalizedSymbols) {
      const found = store.profile.getInstrument(symbol);
      if (found) return found;
    }
  }

  const candidates = store.profile.searchInstruments("");
  const explicitIndex = /指数|指数点|指数点位/.test(text);
  const explicitTradable = /ETF|基金|股|份|手/.test(text);
  const bareIndex = INDEX_TERMS.some((term) => text.includes(term));
  return candidates
    .map((instrument) => ({
      instrument,
      score: instrumentScore(instrument, text, { explicitIndex, explicitTradable, bareIndex }),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.instrument ?? null;
}

function instrumentScore(
  instrument: InstrumentRecord,
  text: string,
  intent: { explicitIndex: boolean; explicitTradable: boolean; bareIndex: boolean },
) {
  let score = 0;
  if (text.includes(instrument.name)) score += 120;
  if (text.includes(instrument.symbol)) score += 140;
  if (INDEX_TERMS.some((term) => text.includes(term) && instrument.name.includes(term))) score += 100;

  if (intent.explicitIndex) score += instrument.tradable ? -60 : 80;
  if (intent.bareIndex && !intent.explicitIndex) score += instrument.tradable ? 45 : -20;
  if (score > 0 && intent.explicitTradable) score += instrument.tradable ? 25 : -45;
  if (/ETF/.test(text) && instrument.instrumentSubtype === "GOLD_ETF") score += 20;

  return score;
}

function searchSuggestions(store: AdvisorStore, text: string) {
  const query = INDEX_TERMS.find((term) => text.includes(term))
    ?? (text.includes("黄金") ? "黄金" : text.includes("科技") ? "科技" : text.slice(0, 12));
  return store.profile.searchInstruments(query).map((instrument) => ({
    assetType: instrument.assetType,
    instrumentId: instrument.id,
    symbol: instrument.symbol,
    name: instrument.name,
    market: instrument.market,
    tradable: instrument.tradable,
    requiresQuantityAndCostReentry: true,
  }));
}

function captureQuantity(text: string, instrument: InstrumentRecord | null) {
  const match = /([0-9]+(?:\.[0-9]+)?)\s*(万股|千股|万份|千份|股|份|手|克|盎司)/i.exec(text);
  if (!match) return null;

  const rawValue = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = quantityMultiplier(unit, instrument);
  return { value: formatNumber(rawValue * multiplier), unit };
}

function quantityMultiplier(unit: string, instrument: InstrumentRecord | null) {
  if (unit === "万股" || unit === "万份") return 10_000;
  if (unit === "千股" || unit === "千份") return 1_000;
  if (unit !== "手") return 1;
  return instrument?.tradable && ["STOCK", "ETF", "INDEX_FUND", "GOLD_ETF"].includes(instrument.assetType)
    ? 100
    : 1;
}

function captureAverageCost(text: string) {
  const labeled = /(?:成本|成本价|价格|买入价|买入均价|均价|持仓价)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)/.exec(text);
  if (labeled) return labeled[1];
  const contextual = /(?:在|以|指数)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:元|点)?/.exec(text);
  if (contextual) return contextual[1];
  return /([0-9]+(?:\.[0-9]+)?)\s*(?:元|点)/.exec(text)?.[1] ?? null;
}

function guessedName(text: string) {
  const term = INDEX_TERMS.find((item) => text.includes(item));
  if (term) return `${term}指数`;
  if (text.includes("黄金")) return "黄金";
  return "未知标的";
}

function formatNumber(value: number) {
  return value.toFixed(4).replace(/\.?0+$/, "");
}
