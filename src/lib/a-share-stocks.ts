import stocks from "@/data/a-share-stocks.json";

export type AShareStock = {
  code: string;
  name: string;
};

const STOCKS = stocks as AShareStock[];

const compact = (value: string) => value.trim().replace(/\s+/g, "").toUpperCase();
const hasHan = (value: string) => /\p{Script=Han}/u.test(value);

export function normalizeAShareCode(value: string): string {
  const digits = value.trim().replace(/\D/g, "");
  return digits.length > 0 && digits.length <= 6 ? digits.padStart(6, "0") : digits;
}

export function findAShareStock(value: string): AShareStock | null {
  const query = compact(value);
  if (!query) return null;
  const code = normalizeAShareCode(query);
  return STOCKS.find((stock) => stock.code === code || compact(stock.name) === query) ?? null;
}

export function searchAShareStocks(value: string, limit = 8): AShareStock[] {
  const query = compact(value);
  if (!query) return STOCKS.slice(0, limit);
  const code = normalizeAShareCode(query);
  const nameQuery = query.replace(/[A-Z0-9.]/g, "");
  const isNameSearch = hasHan(nameQuery || query);
  const ranked = STOCKS.filter((stock) => {
    const stockName = compact(stock.name);
    if (isNameSearch) return stockName.includes(nameQuery || query);
    return stock.code.includes(code) || stockName.includes(query);
  });
  return ranked
    .sort((a, b) => {
      const aName = compact(a.name);
      const bName = compact(b.name);
      const effectiveNameQuery = nameQuery || query;
      const aExact = Number(a.code === code || aName === effectiveNameQuery);
      const bExact = Number(b.code === code || bName === effectiveNameQuery);
      if (aExact !== bExact) return bExact - aExact;
      const aStarts = Number(a.code.startsWith(code) || aName.startsWith(effectiveNameQuery));
      const bStarts = Number(b.code.startsWith(code) || bName.startsWith(effectiveNameQuery));
      if (aStarts !== bStarts) return bStarts - aStarts;
      const aIndex = aName.indexOf(effectiveNameQuery);
      const bIndex = bName.indexOf(effectiveNameQuery);
      if (aIndex !== bIndex) return aIndex - bIndex;
      return bStarts - aStarts;
    })
    .slice(0, limit);
}
