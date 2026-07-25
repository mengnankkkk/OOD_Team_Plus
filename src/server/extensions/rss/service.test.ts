import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDatabase } from "@/server/http/context";
import { seedAuthenticatedUser } from "@tests/helpers/auth";

import { fetchPublicHttpUrl } from "../security/public-url";
import { syncRssFeed } from "./service";

vi.mock("../security/public-url", () => ({
  fetchPublicHttpUrl: vi.fn(),
}));

describe("RSS sync instrument linkage", () => {
  const userId = "rss-link-user";
  const now = "2026-07-25T00:00:00.000Z";

  beforeEach(() => {
    seedAuthenticatedUser({ userId });
    vi.mocked(fetchPublicHttpUrl).mockReset();
    const db = getDatabase();
    db.prepare("DELETE FROM agent_run_events WHERE root_run_id IN (SELECT id FROM agent_runs WHERE user_id=?)").run(userId);
    db.prepare("DELETE FROM agent_runs WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM rss_item_instruments WHERE id LIKE 'rss-service-%'").run();
    db.prepare("DELETE FROM rss_items WHERE feed_id='rss-service-feed'").run();
    db.prepare("DELETE FROM rss_feeds WHERE id='rss-service-feed'").run();
    db.prepare("DELETE FROM watchlist_items WHERE id='rss-service-item'").run();
    db.prepare("DELETE FROM watchlists WHERE id='rss-service-list'").run();
    db.prepare(`INSERT INTO watchlists
      (id,user_id,name,status,created_at,updated_at)
      VALUES ('rss-service-list',?,'RSS 观察','active',?,?)`).run(userId, now, now);
    db.prepare(`INSERT INTO watchlist_items
      (id,watchlist_id,instrument_id,status,added_at,created_at,updated_at)
      VALUES ('rss-service-item','rss-service-list','AAPL','active',?,?,?)`).run(now, now, now);
    db.prepare(`INSERT INTO rss_feeds
      (id,url,title,status,created_by,created_at,updated_at)
      VALUES ('rss-service-feed','https://example.com/rss.xml','Service Feed','active',?,?,?)`)
      .run(userId, now, now);
    db.close();
  });

  it("links newly synced RSS items and emits the linked count", async () => {
    vi.mocked(fetchPublicHttpUrl).mockResolvedValue(new Response(`<?xml version="1.0"?>
      <rss><channel><item>
        <guid>service-guid</guid>
        <title>AAPL 发布季度经营更新</title>
        <link>https://example.com/aapl-update</link>
        <description>Apple 最新业务进展</description>
        <pubDate>Sat, 25 Jul 2026 00:00:00 GMT</pubDate>
      </item></channel></rss>`, {
      status: 200,
      headers: { "content-type": "application/rss+xml" },
    }));

    const result = await syncRssFeed("rss-service-feed", userId, { force: true });

    const db = getDatabase();
    const link = db.prepare(`SELECT rii.instrument_id,rii.match_basis
      FROM rss_item_instruments rii
      JOIN rss_items ri ON ri.id=rii.rss_item_id
      WHERE ri.feed_id='rss-service-feed'`).get();
    const linkedEvent = db.prepare(`SELECT event_type,payload_json FROM agent_run_events
      WHERE root_run_id=? AND event_type='rss.linked'`).get(result.analysisId) as {
      event_type: string;
      payload_json: string;
    };
    db.close();

    expect(result).toMatchObject({ newCount: 1, linkedCount: 1, status: "COMPLETED" });
    expect(link).toEqual({ instrument_id: "AAPL", match_basis: "symbol_exact" });
    expect(JSON.parse(linkedEvent.payload_json)).toMatchObject({
      feedId: "rss-service-feed",
      linkedCount: 1,
    });
  });
});
