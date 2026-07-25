const ATTRIBUTED_PREFIXES = [
  "the user ",
  "user ",
  "the analyst ",
  "analyst ",
  "the bull case ",
  "the bear case ",
  "the recommendation section ",
  "according to ",
  "as reported by ",
  "the report ",
  "management ",
  "多方建议",
  "空方建议",
];
const ADVICE_PREFIXES = [
  "my recommendation is",
  "the recommendation is",
  "recommendation:",
  "action:",
  "i recommend that",
  "i recommend you",
  "i recommend",
  "you should",
  "you must",
  "we should",
  "please",
];
const ENGLISH_ACTIONS = new Set([
  "buy", "buying", "sell", "selling", "hold", "holding", "trade", "trading",
  "exit", "exiting", "add", "adding", "reduce", "reducing",
]);
const CHINESE_ACTIONS = ["买入", "卖出", "加仓", "减仓"];
const CHINESE_PREFIXES = ["立即", "马上", "建议", "应该", "必须"];
const QUOTE_STARTS = new Set(['"', "'", "“", "‘", "«"]);
const CHINESE_ATTRIBUTION = /^(?:用户|分析师|多方|空方|报告|管理层)(?:认为|表示|主张|建议|指出|称)/u;
const ENGLISH_ATTRIBUTION = /^(?:(?:the )?(?:user|analyst|bull(?: case)?|bear(?: case)?|report|management))\s+(?:says?|argues?|claims?|recommends?|suggests?|reports?)\b/iu;

export function neutralizeTradeDirective(value: string, fallback: string): string {
  return hasTradeDirective(value) ? fallback : value;
}

export const neutralizeJudgeNarrative = neutralizeTradeDirective;

function hasTradeDirective(value: string): boolean {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized) return false;
  return normalized.split(/[.!?。！？\n]+/u).some((sentence) => hasTradeDirectiveSentence(sentence));
}

function hasTradeDirectiveSentence(value: string): boolean {
  const normalized = value.trim();
  if (!normalized || isQuoted(normalized)) return false;
  return normalized
    .split(/[,，;；:：]+|\b(?:but|however)\b|(?:但是|但|而)/iu)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .some((clause) => (
      !isQuotedOrAttributed(clause)
      && (hasLeadingTradeDirective(clause) || hasEmbeddedTradeDirective(clause))
    ));
}

function hasEmbeddedTradeDirective(value: string): boolean {
  const lower = value.toLowerCase();
  const englishDirective = /\b(?:you|we)\s+(?:should|must)\s+(?:immediately\s+)?(?:buy|sell|hold|trade|exit|add|reduce)\b/u;
  const englishRecommendation = /\bi\s+recommend(?:\s+that)?(?:\s+you)?\s+(?:to\s+)?(?:buy|sell|hold|trade|exit|add|reduce|buying|selling|holding|trading|exiting|adding|reducing)\b/u;
  const chineseDirective = /(?:你|用户)?(?:应该|必须|建议)\s*(?:立即|马上)?\s*(?:买入|卖出|加仓|减仓)/u;
  return englishDirective.test(lower) || englishRecommendation.test(lower) || chineseDirective.test(value);
}

function hasLeadingTradeDirective(value: string): boolean {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized || isQuotedOrAttributed(normalized)) return false;
  const { remainder, usedAdvicePrefix } = stripAdvicePrefix(normalized);
  if (isQuotedOrAttributed(remainder)) return false;
  if (startsChineseAction(remainder)) return true;
  return ENGLISH_ACTIONS.has(leadingEnglishWord(usedAdvicePrefix ? stripInfinitiveOrSubject(remainder) : remainder));
}

function isQuotedOrAttributed(value: string): boolean {
  const lower = value.toLowerCase();
  return isQuoted(value)
    || ATTRIBUTED_PREFIXES.some((prefix) => lower.startsWith(prefix))
    || CHINESE_ATTRIBUTION.test(value)
    || ENGLISH_ATTRIBUTION.test(value);
}

function isQuoted(value: string): boolean {
  return QUOTE_STARTS.has(value[0] ?? "");
}

function stripAdvicePrefix(value: string): { remainder: string; usedAdvicePrefix: boolean } {
  const lower = value.toLowerCase();
  const prefix = ADVICE_PREFIXES.find((candidate) => lower.startsWith(candidate));
  if (prefix) return { remainder: value.slice(prefix.length).trimStart(), usedAdvicePrefix: true };
  if (lower.startsWith("immediately ")) return { remainder: value.slice("immediately".length).trimStart(), usedAdvicePrefix: false };
  return { remainder: value, usedAdvicePrefix: false };
}

function stripInfinitiveOrSubject(value: string): string {
  const lower = value.toLowerCase();
  if (lower.startsWith("to ")) return value.slice(3).trimStart();
  if (lower.startsWith("you ")) return value.slice(4).trimStart();
  return value;
}

function leadingEnglishWord(value: string): string {
  return value.toLowerCase().split(/[^a-z]+/u, 1)[0] ?? "";
}

function startsChineseAction(value: string): boolean {
  const remainder = stripChinesePrefix(value);
  const action = CHINESE_ACTIONS.find((candidate) => remainder.startsWith(candidate));
  if (!action) return false;
  const next = remainder.slice(action.length, action.length + 1);
  return !next || next.trim() === "" || /[A-Za-z0-9。.!！]/u.test(next);
}

function stripChinesePrefix(value: string): string {
  const prefix = CHINESE_PREFIXES.find((candidate) => value.startsWith(candidate));
  return prefix ? value.slice(prefix.length).trimStart() : value;
}
