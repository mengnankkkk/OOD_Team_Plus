import stocks from "@/data/a-share-stocks.json";

export type AShareStock = {
  code: string;
  name: string;
};

const STOCKS = stocks as AShareStock[];

const compact = (value: string) => value.trim().replace(/\s+/g, "").toUpperCase();

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
  const ranked = STOCKS.filter((stock) => stock.code.includes(code) || compact(stock.name).includes(query));
  return ranked
    .sort((a, b) => {
      const aExact = Number(a.code === code || compact(a.name) === query);
      const bExact = Number(b.code === code || compact(b.name) === query);
      if (aExact !== bExact) return bExact - aExact;
      const aStarts = Number(a.code.startsWith(code) || compact(a.name).startsWith(query));
      const bStarts = Number(b.code.startsWith(code) || compact(b.name).startsWith(query));
      return bStarts - aStarts;
    })
    .slice(0, limit);
}
