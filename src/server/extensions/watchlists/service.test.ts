import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/http/context";

import {
  createWatchlist,
  createWatchlistItem,
  deleteWatchlist,
  listWatchlists,
  moveWatchlistItem,
  removeWatchlistItem,
  updateWatchlist,
  updateWatchlistItem,
} from "./service";

const USER_ID = "watchlist-service-user";
const NOW = "2026-07-25T00:00:00.000Z";

describe("watchlist domain service", () => {
  beforeEach(() => {
    const db = getDatabase();
    db.prepare("DELETE FROM observation_conditions WHERE user_id = ?").run(USER_ID);
    db.prepare("DELETE FROM notifications WHERE user_id = ?").run(USER_ID);
    db.prepare("DELETE FROM watchlist_items WHERE watchlist_id IN (SELECT id FROM watchlists WHERE user_id = ?)").run(USER_ID);
    db.prepare("DELETE FROM watchlists WHERE user_id = ?").run(USER_ID);
    db.prepare("DELETE FROM goals WHERE user_id = ?").run(USER_ID);
    db.prepare("DELETE FROM users WHERE id = ?").run(USER_ID);
    db.prepare("INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)").run(USER_ID, "Service User", NOW);
    db.prepare(`INSERT INTO goals
      (id, user_id, name, target_amount_decimal, horizon, priority, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
      .run("goal-service", USER_ID, "长期增值", "1000000", "LONG", "HIGH", NOW, NOW);
    for (const [id, name, status] of [
      ["wl-service", "持仓观测", "active"],
      ["wl-source", "来源列表", "active"],
      ["wl-target", "目标列表", "active"],
      ["wl-archived", "归档列表", "archived"],
    ]) {
      db.prepare(`INSERT INTO watchlists
        (id, user_id, name, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(id, USER_ID, name, status, NOW, NOW);
    }
    db.close();
  });

  it("persists goal metadata and creates an initial drawdown condition", () => {
    const created = createWatchlistItem(USER_ID, "wl-service", {
      instrumentId: "AAPL",
      reason: "长期观察",
      plannedHorizon: "3-5 年",
      goalId: "goal-service",
      source: "USER",
      initialDrawdownThresholdPct: 12,
    });

    expect(created).toMatchObject({
      instrumentId: "AAPL",
      goalId: "goal-service",
      source: "USER",
      activeConditionCount: 1,
      version: 1,
    });
    const db = getDatabase();
    const condition = db.prepare(`SELECT condition_type, threshold_decimal, watchlist_item_id, window_days
      FROM observation_conditions WHERE watchlist_item_id = ?`).get(created.id);
    db.close();
    expect(condition).toEqual({
      condition_type: "DRAWDOWN_REACH",
      threshold_decimal: "0.12",
      watchlist_item_id: created.id,
      window_days: 20,
    });
  });

  it("returns WATCHLIST_ITEM_EXISTS for an active duplicate", () => {
    const first = createWatchlistItem(USER_ID, "wl-service", { instrumentId: "AAPL", source: "USER" });
    expect(() => createWatchlistItem(USER_ID, "wl-service", { instrumentId: "AAPL", source: "USER" }))
      .toThrowError(expect.objectContaining({
        code: "WATCHLIST_ITEM_EXISTS",
        details: expect.objectContaining({ existingItemId: first.id }),
      }));
  });

  it("reuses the latest removed item when the same instrument is added again", () => {
    const created = createWatchlistItem(USER_ID, "wl-service", { instrumentId: "MSFT", source: "USER" });
    removeWatchlistItem(USER_ID, created.id, created.version);

    const restored = createWatchlistItem(USER_ID, "wl-service", {
      instrumentId: "MSFT",
      reason: "重新关注",
      source: "AGENT",
    });

    expect(restored).toMatchObject({
      id: created.id,
      reason: "重新关注",
      source: "AGENT",
      version: 3,
    });
  });

  it("moves an item and rejects a target-list duplicate", () => {
    const item = createWatchlistItem(USER_ID, "wl-source", { instrumentId: "AAPL", source: "USER" });
    const duplicate = createWatchlistItem(USER_ID, "wl-target", { instrumentId: "AAPL", source: "USER" });

    expect(() => moveWatchlistItem(USER_ID, item.id, "wl-target", item.version))
      .toThrowError(expect.objectContaining({
        code: "WATCHLIST_ITEM_MOVE_CONFLICT",
        details: expect.objectContaining({ existingItemId: duplicate.id }),
      }));
  });

  it("rejects ordinary edits on archived lists but allows restoration", () => {
    expect(() => updateWatchlist(USER_ID, "wl-archived", { name: "不应修改" }, 1))
      .toThrowError(expect.objectContaining({ code: "WATCHLIST_ARCHIVED" }));
    expect(updateWatchlist(USER_ID, "wl-archived", { status: "ACTIVE" }, 1))
      .toMatchObject({ status: "active", version: 2 });
  });

  it("rejects moving an item into an archived list", () => {
    const item = createWatchlistItem(USER_ID, "wl-source", { instrumentId: "MSFT", source: "USER" });
    expect(() => moveWatchlistItem(USER_ID, item.id, "wl-archived", item.version))
      .toThrowError(expect.objectContaining({ code: "WATCHLIST_ARCHIVED" }));
  });

  it("updates item metadata and pauses conditions when removed", () => {
    const item = createWatchlistItem(USER_ID, "wl-service", {
      instrumentId: "SPY",
      source: "IMPORT",
      initialDrawdownThresholdPct: 10,
    });
    const updated = updateWatchlistItem(USER_ID, item.id, {
      reason: "配置观察",
      plannedHorizon: "12 个月",
      goalId: "goal-service",
    }, item.version);
    removeWatchlistItem(USER_ID, item.id, updated.version);

    const db = getDatabase();
    const condition = db.prepare("SELECT status FROM observation_conditions WHERE watchlist_item_id = ?").get(item.id);
    db.close();
    expect(updated).toMatchObject({ reason: "配置观察", plannedHorizon: "12 个月", goalId: "goal-service" });
    expect(condition).toEqual({ status: "paused" });
  });

  it("manages list lifecycle and cascades soft deletion to items and conditions", () => {
    const list = createWatchlist(USER_ID, { name: "新增列表", description: "测试" });
    const archived = updateWatchlist(USER_ID, list.id, { status: "ARCHIVED" }, list.version);
    expect(listWatchlists(USER_ID, "archived", 20).map((item) => item.id)).toContain(list.id);
    const restored = updateWatchlist(USER_ID, list.id, { status: "ACTIVE" }, archived.version);
    const item = createWatchlistItem(USER_ID, list.id, {
      instrumentId: "GLD",
      source: "USER",
      initialDrawdownThresholdPct: 8,
    });

    deleteWatchlist(USER_ID, list.id, restored.version);

    const db = getDatabase();
    const storedItem = db.prepare("SELECT status FROM watchlist_items WHERE id = ?").get(item.id);
    const condition = db.prepare("SELECT status FROM observation_conditions WHERE watchlist_item_id = ?").get(item.id);
    db.close();
    expect(storedItem).toEqual({ status: "removed" });
    expect(condition).toEqual({ status: "paused" });
  });
});
