import { createId, isoNow } from "@/server/http/context";

type Db = {
  prepare: (sql: string) => {
    all: (...params: unknown[]) => unknown[];
    run: (...params: unknown[]) => { changes: number };
  };
};

export type InstrumentMatch = {
  instrumentId: string;
  matchBasis: "symbol_exact" | "name_exact" | "research_link";
  matchedText: string;
};

type RssItem = {
  id: string;
  title: string;
  summary: string | null;
  link: string | null;
};

type Instrument = {
  id: string;
  symbol: string;
  name: string;
};

export function findInstrumentMatches(
  item: { title: string; summary: string | null },
  instruments: Instrument[],
): InstrumentMatch[] {
  const text = `${item.title}\n${item.summary ?? ""}`;
  const matches: InstrumentMatch[] = [];
  for (const instrument of instruments) {
    const symbol = instrument.symbol.trim();
    const name = instrument.name.trim();
    if (symbol && exactTokenPattern(symbol).test(text)) {
      matches.push({
        instrumentId: instrument.id,
        matchBasis: "symbol_exact",
        matchedText: symbol,
      });
      continue;
    }
    if (name && exactTokenPattern(name).test(text)) {
      matches.push({
        instrumentId: instrument.id,
        matchBasis: "name_exact",
        matchedText: name,
      });
    }
  }
  return matches;
}

export function linkRecentRssItems(
  db: Db,
  instrumentIds: string[],
  publishedAfter: string,
): number {
  const ids = [...new Set(instrumentIds)];
  if (!ids.length) return 0;
  const instruments = db.prepare(`SELECT id,symbol,name FROM instruments
    WHERE id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids) as Instrument[];
  if (!instruments.length) return 0;
  const items = db.prepare(`SELECT id,title,summary,link FROM rss_items
    WHERE COALESCE(published_at,created_at) >= ?
    ORDER BY COALESCE(published_at,created_at),id`).all(publishedAfter) as RssItem[];
  const researchLinks = readResearchLinks(db, instruments, items);
  let linked = 0;
  for (const item of items) {
    const deterministic = findInstrumentMatches(item, instruments);
    const matches = mergeMatches(deterministic, researchLinks.get(item.id) ?? []);
    for (const match of matches) {
      linked += db.prepare(`INSERT OR IGNORE INTO rss_item_instruments
        (id,rss_item_id,instrument_id,match_basis,matched_text,created_at)
        VALUES (?,?,?,?,?,?)`).run(
        createId("rss_link"),
        item.id,
        match.instrumentId,
        match.matchBasis,
        match.matchedText,
        isoNow(),
      ).changes;
    }
  }
  return linked;
}

export function loadActiveObservedInstrumentIds(db: Db): string[] {
  const rows = db.prepare(`SELECT DISTINCT instrument_id FROM (
      SELECT instrument_id FROM holdings WHERE status='active'
      UNION ALL
      SELECT wi.instrument_id
      FROM watchlist_items wi
      JOIN watchlists w ON w.id=wi.watchlist_id
      WHERE wi.status='active' AND w.status='active'
    ) ORDER BY instrument_id`).all() as Array<{ instrument_id: string }>;
  return rows.map((row) => row.instrument_id);
}

function readResearchLinks(
  db: Db,
  instruments: Instrument[],
  items: RssItem[],
): Map<string, InstrumentMatch[]> {
  const links = items.filter((item) => item.link).map((item) => item.link as string);
  if (!links.length) return new Map();
  const rows = db.prepare(`SELECT e.source_url,r.instrument_id
    FROM evidence_items e
    JOIN recommendations r ON r.id=e.recommendation_id
    WHERE e.source_url IN (${links.map(() => "?").join(",")})
      AND r.instrument_id IN (${instruments.map(() => "?").join(",")})
      AND lower(r.status)!='deleted'`)
    .all(...links, ...instruments.map((instrument) => instrument.id)) as Array<{
      instrument_id: string;
      source_url: string;
    }>;
  const itemIdsByLink = new Map<string, string[]>();
  for (const item of items) {
    if (!item.link) continue;
    itemIdsByLink.set(item.link, [...(itemIdsByLink.get(item.link) ?? []), item.id]);
  }
  const result = new Map<string, InstrumentMatch[]>();
  for (const row of rows) {
    for (const itemId of itemIdsByLink.get(row.source_url) ?? []) {
      const current = result.get(itemId) ?? [];
      current.push({
        instrumentId: row.instrument_id,
        matchBasis: "research_link",
        matchedText: row.source_url,
      });
      result.set(itemId, current);
    }
  }
  return result;
}

function mergeMatches(
  direct: InstrumentMatch[],
  research: InstrumentMatch[],
): InstrumentMatch[] {
  const byInstrument = new Map<string, InstrumentMatch>();
  for (const match of research) byInstrument.set(match.instrumentId, match);
  for (const match of direct) byInstrument.set(match.instrumentId, match);
  return [...byInstrument.values()].sort((left, right) =>
    left.instrumentId.localeCompare(right.instrumentId));
}

function exactTokenPattern(value: string): RegExp {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, "iu");
}
