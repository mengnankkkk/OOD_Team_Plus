import { beforeEach, describe, expect, it } from "vitest";

import type { PandaSourceExecution } from "@/server/extensions/query/panda-query-executor";
import { getDatabase } from "@/server/http/context";

import { refreshScopedWatchlistMarket } from "./check-market";
import type { WatchlistTarget } from "../notifications/watchlist-alerts";

describe("scoped watchlist market refresh", () => {
  beforeEach(() => {
    const db = getDatabase();
    db.prepare("DELETE FROM agent_runs WHERE user_id='check-market-user'").run();
    db.close();
  });

  it("reports partial when one market group fails", async () => {
    const execute = async ({ sources }: { sources: Array<{ method: string }> }) => {
      if (sources[0].method === "get_us_daily") throw new Error("PANDADATA_NETWORK_FAILED");
      return [] as PandaSourceExecution[];
    };
    const result = await refreshScopedWatchlistMarket(
      "check-market-user",
      [
        target({ id: "cn", symbol: "600519", market: "SH" }),
        target({ id: "us", symbol: "AAPL", market: "US" }),
      ],
      execute as never,
    );

    expect(result).toMatchObject({
      succeededGroupCount: 1,
      failedGroupCount: 1,
      complete: false,
      errorCode: "PANDADATA_NETWORK_FAILED",
    });
  });
});

function target(input: { id: string; symbol: string; market: string }): WatchlistTarget {
  return {
    id: input.id,
    watchlist_id: "check-market-list",
    instrument_id: input.id,
    goal_id: null,
    symbol: input.symbol,
    name: input.symbol,
    market: input.market,
    asset_type: "stock",
    reason: null,
    planned_horizon: null,
    drawdown_threshold_bps: null,
  };
}
