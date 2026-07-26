import { beforeEach, describe, expect, it } from "vitest";

import { createWatchlistEventNotifications, type WatchlistTarget } from "@/server/extensions/notifications/watchlist-alerts";
import { readRecentEvent } from "@/server/extensions/watchlists/aggregation-evidence";
import { getDatabase } from "@/server/http/context";

const USER_ID = "research-link-user";
const OTHER_USER_ID = "research-link-other-user";
const NOW = "2026-07-25T00:00:00.000Z";
const RESEARCH_URL = "https://example.com/private-research";

describe("research-linked RSS user isolation", () => {
  beforeEach(() => {
    const db = getDatabase();
    db.prepare("DELETE FROM notifications WHERE user_id IN (?,?)").run(USER_ID, OTHER_USER_ID);
    db.prepare("DELETE FROM notification_preferences WHERE user_id IN (?,?)").run(USER_ID, OTHER_USER_ID);
    db.prepare("DELETE FROM evidence_items WHERE id LIKE 'research-link-%'").run();
    db.prepare("DELETE FROM recommendations WHERE id LIKE 'research-link-%'").run();
    db.prepare("DELETE FROM rss_item_instruments WHERE id LIKE 'research-link-%'").run();
    db.prepare("DELETE FROM rss_items WHERE id LIKE 'research-link-%'").run();
    db.prepare("DELETE FROM rss_feeds WHERE id LIKE 'research-link-%'").run();
    db.prepare("DELETE FROM users WHERE id IN (?,?)").run(USER_ID, OTHER_USER_ID);
    db.prepare("INSERT INTO users (id,display_name,created_at) VALUES (?,'Owner',?),(?,'Other',?)")
      .run(USER_ID, NOW, OTHER_USER_ID, NOW);
    db.prepare(`INSERT INTO notification_preferences
      (id,user_id,mode,created_at,updated_at)
      VALUES ('research-link-preference',?,'daily_digest',?,?)`)
      .run(USER_ID, NOW, NOW);
    db.prepare(`INSERT INTO rss_feeds
      (id,url,title,status,created_by,created_at,updated_at)
      VALUES ('research-link-feed','https://example.com/private-feed','Private Feed','active',?,?,?)`)
      .run(OTHER_USER_ID, NOW, NOW);
    db.prepare(`INSERT INTO rss_items
      (id,feed_id,guid,title,link,published_at,created_at)
      VALUES ('research-link-rss','research-link-feed','research-link-guid',
        'Unrelated headline',?,?,?)`).run(RESEARCH_URL, NOW, NOW);
    db.prepare(`INSERT INTO rss_item_instruments
      (id,rss_item_id,instrument_id,match_basis,matched_text,created_at)
      VALUES ('research-link-association','research-link-rss','AAPL','research_link',?,?)`)
      .run(RESEARCH_URL, NOW);
    seedResearch(db, OTHER_USER_ID, "other");
    db.close();
  });

  it("hides another user's private research event from aggregation and notifications", () => {
    const db = getDatabase();
    const event = readRecentEvent(db, USER_ID, "AAPL");
    db.close();

    expect(event).toBeNull();
    expect(createWatchlistEventNotifications(USER_ID, [target()])).toBe(0);
  });

  it("restores the event when the current user owns matching research evidence", () => {
    const db = getDatabase();
    seedResearch(db, USER_ID, "owner");
    const event = readRecentEvent(db, USER_ID, "AAPL");
    db.close();

    expect(event).toMatchObject({
      id: "research-link-rss",
      matchBasis: "research_link",
    });
    expect(createWatchlistEventNotifications(USER_ID, [target()])).toBe(1);
  });
});

function seedResearch(db: ReturnType<typeof getDatabase>, userId: string, suffix: string): void {
  db.prepare(`INSERT INTO recommendations
    (id,user_id,instrument_id,action,suitability,position_range_json,add_conditions_json,
     reasons_json,counter_evidence_json,risks_json,alternatives_json,status,created_at,updated_at)
    VALUES (?,?, 'AAPL','WATCH','HIGH','[]','[]','[]','[]','[]','[]','ACTIVE',?,?)`)
    .run(`research-link-rec-${suffix}`, userId, NOW, NOW);
  db.prepare(`INSERT INTO evidence_items
    (id,user_id,recommendation_id,kind,title,summary,source,source_url,created_at)
    VALUES (?,?,?,'research','Private research','Private research','TEST',?,?)`)
    .run(
      `research-link-evidence-${suffix}`,
      userId,
      `research-link-rec-${suffix}`,
      RESEARCH_URL,
      NOW,
    );
}

function target(): WatchlistTarget {
  return {
    id: "research-link-item",
    watchlist_id: "research-link-list",
    instrument_id: "AAPL",
    goal_id: null,
    symbol: "AAPL",
    name: "Apple",
    market: "US",
    asset_type: "stock",
    reason: "长期观察",
    planned_horizon: "3-5 年",
    drawdown_threshold_bps: null,
  };
}
