import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/http/context";

import { aggregateWatchlistItems, computeRiskAggregate } from "./aggregation";

const USER_ID = "watchlist-aggregation-user";
const WATCHLIST_ID = "watchlist-aggregation";
const NOW = new Date();
const NOW_ISO = NOW.toISOString();

describe("watchlist aggregation", () => {
  beforeEach(() => {
    const db = getDatabase();
    db.prepare("DELETE FROM notifications WHERE user_id = ?").run(USER_ID);
    db.prepare("DELETE FROM observation_condition_events WHERE user_id = ?").run(USER_ID);
    db.prepare("DELETE FROM observation_conditions WHERE user_id = ?").run(USER_ID);
    db.prepare("DELETE FROM evidence_items WHERE user_id = ?").run(USER_ID);
    db.prepare("DELETE FROM recommendations WHERE user_id = ?").run(USER_ID);
    db.prepare("DELETE FROM holding_snapshots WHERE portfolio_snapshot_id IN (SELECT id FROM portfolio_snapshots WHERE user_id = ?)").run(USER_ID);
    db.prepare("DELETE FROM portfolio_snapshots WHERE user_id = ?").run(USER_ID);
    db.prepare("DELETE FROM rss_item_instruments WHERE id LIKE 'aggregation-%'").run();
    db.prepare("DELETE FROM rss_items WHERE id LIKE 'aggregation-%'").run();
    db.prepare("DELETE FROM rss_feeds WHERE id = 'aggregation-feed'").run();
    db.prepare("DELETE FROM market_snapshots WHERE id LIKE 'aggregation-%'").run();
    db.prepare("DELETE FROM watchlist_items WHERE watchlist_id = ?").run(WATCHLIST_ID);
    db.prepare("DELETE FROM watchlists WHERE id = ? OR user_id = ?").run(WATCHLIST_ID, USER_ID);
    db.prepare("DELETE FROM goals WHERE id = 'aggregation-goal' OR user_id = ?").run(USER_ID);
    db.prepare("DELETE FROM users WHERE id = ?").run(USER_ID);
    db.prepare("INSERT INTO users (id, display_name, created_at) VALUES (?, 'Aggregation User', ?)").run(USER_ID, NOW_ISO);
    db.prepare(`INSERT INTO goals
      (id,user_id,name,target_amount_decimal,horizon,priority,status,created_at,updated_at)
      VALUES ('aggregation-goal',?,'长期增值','1000000','LONG','HIGH','active',?,?)`)
      .run(USER_ID, NOW_ISO, NOW_ISO);
    db.prepare(`INSERT INTO watchlists
      (id,user_id,name,status,created_at,updated_at) VALUES (?,?,'重点观察','active',?,?)`)
      .run(WATCHLIST_ID, USER_ID, NOW_ISO, NOW_ISO);
    for (const item of [
      ["aggregation-held", "AAPL", "aggregation-goal"],
      ["aggregation-unheld", "SPY", null],
    ]) {
      db.prepare(`INSERT INTO watchlist_items
        (id,watchlist_id,instrument_id,goal_id,source_type,reason,status,added_at,created_at,updated_at)
        VALUES (?,?,?,?, 'user','观察基本面','active',?,?,?)`)
        .run(item[0], WATCHLIST_ID, item[1], item[2], NOW_ISO, NOW_ISO, NOW_ISO);
    }
    db.close();
  });

  it("aggregates real market, portfolio, evidence, event, recommendation, and alert data", () => {
    const db = getDatabase();
    seedMarketPoints(db, "AAPL", risingRiskPrices());
    seedMarketPoints(db, "SPY", stablePrices(20));
    seedPortfolio(db);
    seedEvidenceAndRecommendation(db);
    seedEvent(db);
    seedConditionAndAlert(db);
    db.close();

    const items = aggregateWatchlistItems(USER_ID, WATCHLIST_ID, 20);
    const held = items.find((item) => item.id === "aggregation-held")!;
    const unheld = items.find((item) => item.id === "aggregation-unheld")!;

    expect(held.market).toMatchObject({
      price: 110,
      previousClose: 94,
      dailyMovePct: expect.closeTo(110 / 94 - 1, 8),
      status: "available",
    });
    expect(held.portfolioRelation).toMatchObject({ isHeld: true, quantity: 2, weight: 0.6 });
    expect(unheld.portfolioRelation.isHeld).toBe(false);
    expect(held.goal).toEqual({ id: "aggregation-goal", name: "长期增值" });
    expect(held.risk.status).toBe("increasing");
    expect(held.valuation).toMatchObject({ status: "fair", source: "PANDADATA" });
    expect(held.recentEvent).toMatchObject({
      id: "aggregation-rss-item",
      source: "Aggregation Feed",
      matchBasis: "symbol_exact",
    });
    expect(held.industryConcentration).toMatchObject({
      label: "组合行业集中度",
      sector: "Technology",
      weight: 0.8,
      level: "critical",
    });
    expect(held.latestAgentConclusion?.recommendationId).toBe("rec-watchlist");
    expect(held.activeConditionCount).toBe(1);
    expect(held.triggeredConditionCount).toBe(1);
    expect(held.unreadAlertCount).toBe(1);
    expect(held.lastCheckedAt).toBe(checkTime());
  });

  it("uses the approved thresholds for risk direction", () => {
    expect(computeRiskAggregate(stableRiskPoints(1.26)).status).toBe("increasing");
    expect(computeRiskAggregate(stableRiskPoints(0.79)).status).toBe("decreasing");
    expect(computeRiskAggregate(stableRiskPoints(1.1)).status).toBe("stable");
    expect(computeRiskAggregate(stableRiskPoints(1).slice(0, 19))).toMatchObject({
      status: "insufficient_data",
      dataAsOf: null,
    });
  });

  it("returns explicit insufficient-data states instead of invented advanced data", () => {
    const [item] = aggregateWatchlistItems(USER_ID, WATCHLIST_ID, 1);

    expect(item.market).toMatchObject({ status: "insufficient_data", dataAsOf: null });
    expect(item.portfolioRelation).toEqual({
      isHeld: false,
      quantity: null,
      weight: null,
      cost: null,
      unrealizedGainPct: null,
      dataAsOf: null,
    });
    expect(item.risk).toMatchObject({ status: "insufficient_data", dataAsOf: null });
    expect(item.valuation).toMatchObject({ status: "insufficient_data", dataAsOf: null });
    expect(item.industryConcentration).toMatchObject({ level: "insufficient_data", dataAsOf: null });
    expect(item.recentEvent).toBeNull();
    expect(item.latestAgentConclusion).toBeNull();
    expect(item.lastCheckedAt).toBeNull();
  });

  it("derives the compatibility drawdown alias from the structured rule", () => {
    const db = getDatabase();
    db.prepare("UPDATE watchlist_items SET drawdown_threshold_bps=2500 WHERE id='aggregation-held'").run();
    db.prepare(`INSERT INTO observation_conditions
      (id,user_id,instrument_id,condition_type,threshold_decimal,status,watchlist_item_id,
       severity,window_days,config_json,created_at,updated_at)
      VALUES ('aggregation-drawdown',?,'AAPL','DRAWDOWN_REACH','0.12','active','aggregation-held',
        'attention',20,'{}',?,?)`).run(USER_ID, NOW_ISO, NOW_ISO);
    db.close();

    const item = aggregateWatchlistItems(USER_ID, WATCHLIST_ID, 20)
      .find((value) => value.id === "aggregation-held");

    expect(item?.drawdown_threshold_bps).toBe(1200);
  });

  it("does not revive a legacy drawdown threshold after the structured rule is deleted", () => {
    const db = getDatabase();
    db.prepare("UPDATE watchlist_items SET drawdown_threshold_bps=2500 WHERE id='aggregation-held'").run();
    db.prepare(`INSERT INTO observation_conditions
      (id,user_id,instrument_id,condition_type,threshold_decimal,status,watchlist_item_id,
       severity,window_days,config_json,created_at,updated_at)
      VALUES ('aggregation-deleted-drawdown',?,'AAPL','DRAWDOWN_REACH','0.12','deleted',
        'aggregation-held','attention',20,'{}',?,?)`).run(USER_ID, NOW_ISO, NOW_ISO);
    db.close();

    const item = aggregateWatchlistItems(USER_ID, WATCHLIST_ID, 20)
      .find((value) => value.id === "aggregation-held");

    expect(item?.drawdown_threshold_bps).toBeNull();
  });

  it("does not present a paused drawdown rule as an active compatibility threshold", () => {
    const db = getDatabase();
    db.prepare("UPDATE watchlist_items SET drawdown_threshold_bps=2500 WHERE id='aggregation-held'").run();
    db.prepare(`INSERT INTO observation_conditions
      (id,user_id,instrument_id,condition_type,threshold_decimal,status,watchlist_item_id,
       severity,window_days,config_json,created_at,updated_at)
      VALUES ('aggregation-paused-drawdown',?,'AAPL','DRAWDOWN_REACH','0.12','paused',
        'aggregation-held','attention',20,'{}',?,?)`).run(USER_ID, NOW_ISO, NOW_ISO);
    db.close();

    const item = aggregateWatchlistItems(USER_ID, WATCHLIST_ID, 20)
      .find((value) => value.id === "aggregation-held");
    expect(item?.drawdown_threshold_bps).toBeNull();
  });
});

type Db = ReturnType<typeof getDatabase>;

function seedMarketPoints(db: Db, instrumentId: string, prices: number[]): void {
  prices.forEach((close, index) => {
    const date = new Date(NOW);
    date.setUTCDate(date.getUTCDate() - (prices.length - index - 1));
    const day = date.toISOString().slice(0, 10);
    const previousClose = index === 0 ? close : prices[index - 1];
    db.prepare(`INSERT INTO market_snapshots
      (id,instrument_id,data_source_id,snapshot_type,as_of,trading_date,market_timezone,
       freshness_status,quality_status,raw_payload_json,created_at)
      VALUES (?,?, 'source-pandadata-api','daily',?,?,'America/New_York','fresh','valid',?,?)`)
      .run(`aggregation-${instrumentId}-${index}`, instrumentId, date.toISOString(), day,
        JSON.stringify({ date: day, close, pre_close: previousClose }), date.toISOString());
  });
}

function seedPortfolio(db: Db): void {
  const old = new Date(NOW.getTime() - 86_400_000).toISOString();
  for (const snapshot of [["aggregation-portfolio-old", old], ["aggregation-portfolio-latest", NOW_ISO]]) {
    db.prepare(`INSERT INTO portfolio_snapshots
      (id,user_id,portfolio_id,cash_decimal,total_market_value_decimal,data_quality,source_statuses_json,as_of,created_at)
      VALUES (?,?, 'aggregation-portfolio','0','1000','complete','[]',?,?)`)
      .run(snapshot[0], USER_ID, snapshot[1], snapshot[1]);
  }
  for (const row of [
    ["aggregation-old-aapl", "aggregation-portfolio-old", "AAPL", "9", "100", "120", "1080", "180", 10000, old],
    ["aggregation-latest-aapl", "aggregation-portfolio-latest", "AAPL", "2", "140", "150", "600", "20", 6000, NOW_ISO],
    ["aggregation-latest-msft", "aggregation-portfolio-latest", "MSFT", "1", "180", "200", "200", "20", 2000, NOW_ISO],
    ["aggregation-latest-gld", "aggregation-portfolio-latest", "GLD", "1", "180", "200", "200", "20", 2000, NOW_ISO],
  ]) {
    db.prepare(`INSERT INTO holding_snapshots
      (id,portfolio_snapshot_id,instrument_id,quantity_decimal,cost_decimal,price_decimal,
       market_value_decimal,unrealized_pnl_decimal,weight_bps,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(...row);
  }
}

function seedEvidenceAndRecommendation(db: Db): void {
  db.prepare(`INSERT INTO recommendations
    (id,user_id,analysis_id,instrument_id,action,suitability,summary,position_range_json,add_conditions_json,
     reasons_json,counter_evidence_json,risks_json,alternatives_json,compliance_json,provenance_json,status,created_at,updated_at)
    VALUES ('rec-watchlist',?,'analysis-watchlist','AAPL','WATCH','HIGH','继续观察','[]','[]','[]','[]','[]','[]','{}','{}','ACTIVE',?,?)`)
    .run(USER_ID, NOW_ISO, NOW_ISO);
  db.prepare(`INSERT INTO evidence_items
    (id,user_id,recommendation_id,kind,title,summary,source,metric_code,value_text,observed_at,created_at)
    VALUES ('aggregation-valuation',?,'rec-watchlist','valuation','估值状态','估值合理','PANDADATA',
      'valuation_status','fair',?,?)`).run(USER_ID, NOW_ISO, NOW_ISO);
}

function seedEvent(db: Db): void {
  db.prepare(`INSERT INTO rss_feeds
    (id,url,title,status,created_by,created_at,updated_at) VALUES
    ('aggregation-feed','https://example.com/feed','Aggregation Feed','active',?,?,?)`)
    .run(USER_ID, NOW_ISO, NOW_ISO);
  db.prepare(`INSERT INTO rss_items
    (id,feed_id,guid,title,link,published_at,created_at) VALUES
    ('aggregation-rss-item','aggregation-feed','aggregation-guid','Apple reports earnings',
     'https://example.com/apple',?,?)`).run(NOW_ISO, NOW_ISO);
  db.prepare(`INSERT INTO rss_item_instruments
    (id,rss_item_id,instrument_id,match_basis,matched_text,created_at) VALUES
    ('aggregation-rss-link','aggregation-rss-item','AAPL','symbol_exact','AAPL',?)`).run(NOW_ISO);
}

function seedConditionAndAlert(db: Db): void {
  db.prepare(`INSERT INTO observation_conditions
    (id,user_id,instrument_id,condition_type,threshold_decimal,status,watchlist_item_id,
     severity,config_json,last_evaluated_at,created_at,updated_at)
    VALUES ('aggregation-condition',?,'AAPL','PRICE_BELOW','100','active','aggregation-held',
      'attention','{}',?,?,?)`).run(USER_ID, checkTime(), NOW_ISO, checkTime());
  db.prepare(`INSERT INTO observation_condition_events
    (id,condition_id,user_id,observed_value,threshold_decimal,evaluation_key,triggered_at,reason)
    VALUES ('aggregation-event','aggregation-condition',?,'99','100','aggregation-evaluation',?,'manual')`)
    .run(USER_ID, checkTime());
  db.prepare(`INSERT INTO notifications
    (id,user_id,severity,title,body_text,source_type,source_id,metadata_json,created_at,updated_at)
    VALUES ('aggregation-alert',?,'important','提醒','触发规则','WATCH_CONDITION','aggregation-held','{}',?,?)`)
    .run(USER_ID, checkTime(), checkTime());
}

function risingRiskPrices(): number[] {
  return [...Array.from({ length: 30 }, (_, index) => 100 + index * 0.2),
    106, 112, 101, 115, 98, 117, 96, 120, 94, 110];
}

function stablePrices(length: number): number[] { return Array.from({ length }, (_, index) => 100 + index * 0.2); }

function stableRiskPoints(recentScale: number) {
  const prices = Array.from({ length: 20 }, () => 100);
  for (let index = 0; index < 9; index += 1) {
    prices.push(prices.at(-1)! * (1 + (index % 2 === 0 ? 0.01 : -0.01)));
  }
  prices.push(prices.at(-1)!);
  for (let index = 0; index < 9; index += 1) {
    prices.push(prices.at(-1)! * (1 + (index % 2 === 0 ? 0.01 : -0.01) * recentScale));
  }
  prices.push(prices.at(-1)!);
  return prices.map((close, index) => ({
    date: `2026-06-${String(index + 1).padStart(2, "0")}`,
    close,
    previousClose: index === 0 ? close : prices[index - 1],
  }));
}

function checkTime(): string {
  return new Date(NOW.getTime() - 60_000).toISOString();
}
