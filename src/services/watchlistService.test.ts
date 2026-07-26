import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/frontend-migration/api", () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
}));

import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
} from "@/features/frontend-migration/api";

import {
  checkWatchlist,
  checkWatchlistItem,
  createWatchlist,
  createWatchlistItem,
  deleteWatchlist,
  listWatchlistItems,
  listWatchlists,
  moveWatchlistItem,
  removeWatchlistItem,
  resolveWatchlistInstrument,
  updateWatchlist,
  updateWatchlistItem,
} from "./watchlistService";

describe("watchlistService", () => {
  beforeEach(() => {
    vi.mocked(apiDelete).mockReset();
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiPatch).mockReset();
    vi.mocked(apiPost).mockReset();
  });

  it("lists active or archived watchlists with the public status query", async () => {
    vi.mocked(apiGet).mockResolvedValue({ items: [{ id: "wl_1" }] });

    await listWatchlists();
    await listWatchlists("archived");

    expect(apiGet).toHaveBeenNthCalledWith(
      1,
      "/api/v1/watchlists?status=active&limit=100",
    );
    expect(apiGet).toHaveBeenNthCalledWith(
      2,
      "/api/v1/watchlists?status=archived&limit=100",
    );
  });

  it("creates, updates, and deletes lists using optimistic versions", async () => {
    const list = {
      id: "wl_1",
      name: "核心观察",
      description: null,
      status: "active" as const,
      itemCount: 0,
      activeConditionCount: 0,
      unreadAlertCount: 0,
      version: 3,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };
    vi.mocked(apiPost).mockResolvedValue(list);
    vi.mocked(apiPatch).mockResolvedValue({ ...list, name: "长期观察", version: 4 });

    await createWatchlist({ name: "核心观察", description: null });
    await updateWatchlist(list, { name: "长期观察" });
    await deleteWatchlist(list);

    expect(apiPost).toHaveBeenCalledWith("/api/v1/watchlists", {
      name: "核心观察",
      description: null,
    });
    expect(apiPatch).toHaveBeenCalledWith(
      "/api/v1/watchlists/wl_1",
      { name: "长期观察" },
      3,
    );
    expect(apiDelete).toHaveBeenCalledWith(
      "/api/v1/watchlists/wl_1",
      undefined,
      3,
    );
  });

  it("sends goalId and initial drawdown threshold", async () => {
    vi.mocked(apiPost).mockResolvedValue({
      id: "item_1",
      watchlistId: "wl_1",
      instrumentId: "600519.SH",
      reason: "长期观察",
      plannedHorizon: "3-5 年",
      goalId: "goal_1",
      source: "USER",
      activeConditionCount: 1,
      version: 1,
    });

    await createWatchlistItem("wl_1", {
      instrumentId: "600519.SH",
      reason: "长期观察",
      plannedHorizon: "3-5 年",
      goalId: "goal_1",
      initialDrawdownThresholdPct: 12,
    });

    expect(apiPost).toHaveBeenCalledWith(
      "/api/v1/watchlists/wl_1/items",
      expect.objectContaining({
        goalId: "goal_1",
        initialDrawdownThresholdPct: 12,
      }),
    );
  });

  it("resolves a selected instrument before creating an item", async () => {
    vi.mocked(apiPost).mockResolvedValue({
      instrumentId: "600519.SH",
      symbol: "600519",
      name: "贵州茅台",
      market: "SH",
      assetType: "STOCK",
      sector: "食品饮料",
      tradable: true,
    });

    const result = await resolveWatchlistInstrument({
      symbol: "600519",
      name: "贵州茅台",
      market: "SH",
      assetType: "stock",
    });

    expect(apiPost).toHaveBeenCalledWith("/api/v1/instruments/resolve", {
      symbol: "600519",
      name: "贵州茅台",
      market: "SH",
      assetType: "stock",
    });
    expect(result.instrumentId).toBe("600519.SH");
  });

  it("preserves insufficient-data states from the aggregate API", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      items: [{
        id: "item_1",
        valuation: {
          status: "insufficient_data",
          label: "暂无估值证据",
          source: null,
          dataAsOf: null,
        },
      }],
      summary: {
        itemCount: 1,
        heldCount: 0,
        activeConditionCount: 0,
        unreadAlertCount: 0,
        insufficientDataCount: 1,
        lastCheckedAt: null,
      },
    });

    const result = await listWatchlistItems("wl_1");

    expect(apiGet).toHaveBeenCalledWith(
      "/api/v1/watchlists/wl_1/items?limit=100",
    );
    expect(result.items[0]?.valuation.status).toBe("insufficient_data");
    expect(result.summary.insufficientDataCount).toBe(1);
  });

  it("updates, moves, and removes items with the current version", async () => {
    const item = {
      id: "item_1",
      watchlistId: "wl_source",
      instrumentId: "600519.SH",
      reason: null,
      plannedHorizon: null,
      goalId: null,
      source: "USER" as const,
      activeConditionCount: 0,
      version: 7,
    };
    vi.mocked(apiPatch).mockResolvedValue({ ...item, reason: "等待估值", version: 8 });
    vi.mocked(apiPost).mockResolvedValue({ ...item, watchlistId: "wl_target", version: 8 });

    await updateWatchlistItem(item, { reason: "等待估值", goalId: "goal_1" });
    await moveWatchlistItem(item, "wl_target");
    await removeWatchlistItem(item);

    expect(apiPatch).toHaveBeenCalledWith(
      "/api/v1/watchlist-items/item_1",
      { reason: "等待估值", goalId: "goal_1" },
      7,
    );
    expect(apiPost).toHaveBeenCalledWith(
      "/api/v1/watchlist-items/item_1/move",
      { targetWatchlistId: "wl_target" },
      7,
    );
    expect(apiDelete).toHaveBeenCalledWith(
      "/api/v1/watchlist-items/item_1",
      undefined,
      7,
    );
  });

  it("checks a list or item with forced market refresh", async () => {
    vi.mocked(apiPost).mockResolvedValue({
      status: "SUCCEEDED",
      checkedItemCount: 1,
      itemIds: ["item_1"],
      evaluatedConditionCount: 2,
      createdNotificationCount: 1,
      marketRefreshAttempted: true,
      marketRefreshSucceeded: true,
      dataAsOf: "2026-07-25",
      errorCode: null,
      errorMessage: null,
    });

    await checkWatchlist("wl_1");
    await checkWatchlistItem("item_1");

    expect(apiPost).toHaveBeenNthCalledWith(
      1,
      "/api/v1/watchlists/wl_1/check",
      { forceMarketRefresh: true },
    );
    expect(apiPost).toHaveBeenNthCalledWith(
      2,
      "/api/v1/watchlist-items/item_1/check",
      { forceMarketRefresh: true },
    );
  });
});
