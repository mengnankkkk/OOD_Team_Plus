const MARKET_FIELDS = "今开|昨收|最高价|最低价|涨停价|跌停价|换手率|量比|成交量|成交额|动态市盈率|市净率";

export function sanitizeResearchText(value: string, maxLength = 500): string {
  const original = String(value ?? "");
  const hasTable = (original.match(/\|/gu) ?? []).length >= 3
    || (/今开|昨收|动态市盈率|市净率/u.test(original) && /[-|]/u.test(original));
  let text = original
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gmu, "")
    .replace(/^\s*>\s?/gmu, "")
    .replaceAll("_", " ")
    .replaceAll("|", " ")
    .replace(/-{3,}/gu, " ")
    .replace(/([A-Za-z0-9\u4e00-\u9fff])-{1,2}(?=\s|$)/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();

  if (hasTable) {
    text = text
      .replace(/(?:最新价格|实时股价|行情|走势图)[：:\s]*.*?(?=(?:最新新闻|最新资讯|新闻|财报|公告|$))/u, "行情字段暂无完整数据。")
      .replace(new RegExp(`(?:${MARKET_FIELDS})\\s*[-—–](?=\\s|$)`, "gu"), "$&暂无")
      .replace(/(?:\s*[-—–]\s*){2,}/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
  }

  return text.slice(0, maxLength).trim();
}
