import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/http/context";

import { findInstrumentMatches, linkRecentRssItems } from "./instrument-linker";

describe("RSS instrument linker", () => {
  const now = "2026-07-25T00:00:00.000Z";

  beforeEach(() => {
    const db = getDatabase();
    db.prepare("DELETE FROM rss_item_instruments WHERE id LIKE 'linker-%'").run();
    db.prepare("DELETE FROM rss_items WHERE id LIKE 'linker-%'").run();
    db.prepare("DELETE FROM rss_feeds WHERE id='linker-feed'").run();
    db.prepare("DELETE FROM evidence_items WHERE id LIKE 'linker-%'").run();
    db.prepare("DELETE FROM recommendations WHERE id LIKE 'linker-%'").run();
    db.prepare(`INSERT INTO rss_feeds
      (id,url,title,status,created_by,created_at,updated_at)
      VALUES ('linker-feed','https://example.com/linker','Linker Feed','active','linker-user',?,?)`)
      .run(now, now);
    db.close();
  });

  it("links an exact symbol with token boundaries", () => {
    expect(findInstrumentMatches(
      { title: "600519 发布年度报告", summary: null },
      [{ id: "600519.SH", symbol: "600519", name: "贵州茅台" }],
    )).toEqual([
      { instrumentId: "600519.SH", matchBasis: "symbol_exact", matchedText: "600519" },
    ]);
    expect(findInstrumentMatches(
      { title: "代码 1600519 未命中", summary: null },
      [{ id: "600519.SH", symbol: "600519", name: "贵州茅台" }],
    )).toHaveLength(0);
  });

  it("links an exact full name and rejects a partial name", () => {
    expect(findInstrumentMatches(
      { title: "贵州茅台发布公告", summary: null },
      [{ id: "600519.SH", symbol: "600519", name: "贵州茅台" }],
    )).toEqual([
      { instrumentId: "600519.SH", matchBasis: "name_exact", matchedText: "贵州茅台" },
    ]);
    expect(findInstrumentMatches(
      { title: "茅台发布公告", summary: null },
      [{ id: "600519.SH", symbol: "600519", name: "贵州茅台" }],
    )).toHaveLength(0);
  });

  it("matches English names case-insensitively with token boundaries", () => {
    const instruments = [{ id: "AAPL", symbol: "AAPL", name: "Apple" }];

    expect(findInstrumentMatches(
      { title: "apple releases a product update", summary: null },
      instruments,
    )).toEqual([
      { instrumentId: "AAPL", matchBasis: "name_exact", matchedText: "Apple" },
    ]);
    expect(findInstrumentMatches(
      { title: "Appleton and PineApple publish updates", summary: null },
      instruments,
    )).toHaveLength(0);
  });

  it("persists recent deterministic links once", () => {
    const db = getDatabase();
    db.prepare(`INSERT INTO rss_items
      (id,feed_id,guid,title,summary,published_at,created_at)
      VALUES ('linker-item','linker-feed','linker-guid','AAPL 发布季度业绩','Apple 经营更新',?,?)`)
      .run(now, now);

    const first = linkRecentRssItems(db, ["AAPL"], "2026-07-01T00:00:00.000Z");
    const second = linkRecentRssItems(db, ["AAPL"], "2026-07-01T00:00:00.000Z");
    const rows = db.prepare(`SELECT rss_item_id,instrument_id,match_basis,matched_text
      FROM rss_item_instruments WHERE rss_item_id='linker-item'`).all();
    db.close();

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(rows).toEqual([{
      rss_item_id: "linker-item",
      instrument_id: "AAPL",
      match_basis: "symbol_exact",
      matched_text: "AAPL",
    }]);
  });

  it("links every RSS item that shares an explicit research URL", () => {
    const db = getDatabase();
    const researchUrl = "https://example.com/shared-research";
    for (const [id, guid] of [
      ["linker-research-item-a", "linker-research-guid-a"],
      ["linker-research-item-b", "linker-research-guid-b"],
    ]) {
      db.prepare(`INSERT INTO rss_items
        (id,feed_id,guid,title,link,published_at,created_at)
        VALUES (?,'linker-feed',?,'Unrelated headline',?,?,?)`)
        .run(id, guid, researchUrl, now, now);
    }
    db.prepare(`INSERT INTO recommendations
      (id,user_id,instrument_id,action,suitability,position_range_json,add_conditions_json,
       reasons_json,counter_evidence_json,risks_json,alternatives_json,status,created_at,updated_at)
      VALUES ('linker-recommendation','linker-user','AAPL','WATCH','HIGH','[]','[]',
        '[]','[]','[]','[]','ACTIVE',?,?)`).run(now, now);
    db.prepare(`INSERT INTO evidence_items
      (id,user_id,recommendation_id,kind,title,summary,source,source_url,created_at)
      VALUES ('linker-evidence','linker-user','linker-recommendation','research',
        'Research','Research','TEST',?,?)`).run(researchUrl, now);

    const linked = linkRecentRssItems(db, ["AAPL"], "2026-07-01T00:00:00.000Z");
    const rows = db.prepare(`SELECT rss_item_id,instrument_id,match_basis FROM rss_item_instruments
      WHERE rss_item_id LIKE 'linker-research-item-%' ORDER BY rss_item_id`).all();
    db.close();

    expect(linked).toBe(2);
    expect(rows).toEqual([
      {
        rss_item_id: "linker-research-item-a",
        instrument_id: "AAPL",
        match_basis: "research_link",
      },
      {
        rss_item_id: "linker-research-item-b",
        instrument_id: "AAPL",
        match_basis: "research_link",
      },
    ]);
  });
});
