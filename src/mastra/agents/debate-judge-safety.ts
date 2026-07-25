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
const CHINESE_PREFIXES = ["立即", "马上", "应该", "必须"];
const QUOTE_STARTS = new Set(['"', "'", "“", "‘", "«"]);

export function neutralizeJudgeNarrative(value: string, fallback: string): string {
  return hasLeadingTradeDirective(value) ? fallback : value;
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
  return QUOTE_STARTS.has(value[0] ?? "") || ATTRIBUTED_PREFIXES.some((prefix) => lower.startsWith(prefix));
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
