import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { alertKeys, invalidateAlertQueries } from "./alertKeys";

describe("alert query keys", () => {
  it("invalidates every alert filter for one user", async () => {
    const client = new QueryClient();
    client.setQueryData(alertKeys.list("user-a", "all"), ["all"]);
    client.setQueryData(alertKeys.list("user-a", "WATCHLIST_EVENT"), ["events"]);
    client.setQueryData(alertKeys.list("user-b", "all"), ["other"]);

    await invalidateAlertQueries(client, "user-a");

    expect(client.getQueryState(alertKeys.list("user-a", "all"))?.isInvalidated).toBe(true);
    expect(client.getQueryState(alertKeys.list("user-a", "WATCHLIST_EVENT"))?.isInvalidated).toBe(true);
    expect(client.getQueryState(alertKeys.list("user-b", "all"))?.isInvalidated).toBe(false);
  });
});
