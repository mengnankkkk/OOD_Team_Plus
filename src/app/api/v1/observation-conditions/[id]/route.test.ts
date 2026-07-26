import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/http/context";
import { authenticatedRequest, seedAuthenticatedUser } from "@tests/helpers/auth";

import { DELETE, PATCH } from "./route";

describe("/api/v1/observation-conditions/[id]", () => {
  const userId = "condition-detail-user";
  const now = "2026-07-25T00:00:00.000Z";

  beforeEach(() => {
    seedAuthenticatedUser({ userId });
    const db = getDatabase();
    db.prepare("DELETE FROM observation_conditions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM watchlist_items WHERE id = 'condition-detail-item'").run();
    db.prepare("DELETE FROM watchlists WHERE id = 'condition-detail-list'").run();
    db.prepare(`INSERT INTO watchlists
      (id,user_id,name,status,created_at,updated_at)
      VALUES ('condition-detail-list',?,'规则编辑','active',?,?)`).run(userId, now, now);
    db.prepare(`INSERT INTO watchlist_items
      (id,watchlist_id,instrument_id,status,added_at,created_at,updated_at)
      VALUES ('condition-detail-item','condition-detail-list','AAPL','active',?,?,?)`).run(now, now, now);
    db.prepare(`INSERT INTO observation_conditions
      (id,user_id,instrument_id,condition_type,threshold_decimal,status,watchlist_item_id,severity,window_days,config_json,created_at,updated_at,version)
      VALUES ('condition-detail',?,'AAPL','DRAWDOWN_REACH','0.10','active','condition-detail-item','attention',20,'{}',?,?,1)`)
      .run(userId, now, now);
    db.close();
  });

  it("patches threshold, window, severity, and status", async () => {
    const response = await PATCH(
      authenticatedRequest("http://localhost/api/v1/observation-conditions/condition-detail", {
        method: "PATCH",
        body: JSON.stringify({
          threshold: "0.15",
          windowDays: 40,
          severity: "URGENT",
          status: "PAUSED",
        }),
        headers: { "If-Match": "1" },
      }, { userId }),
      { params: Promise.resolve({ id: "condition-detail" }) },
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      threshold: "0.15",
      windowDays: 40,
      severity: "URGENT",
      status: "PAUSED",
      version: 2,
    });
  });

  it("soft deletes with optimistic locking", async () => {
    const response = await DELETE(
      authenticatedRequest("http://localhost/api/v1/observation-conditions/condition-detail", {
        method: "DELETE",
        headers: { "If-Match": "1" },
      }, { userId }),
      { params: Promise.resolve({ id: "condition-detail" }) },
    );
    expect(response.status).toBe(204);

    const db = getDatabase();
    expect(db.prepare("SELECT status,version FROM observation_conditions WHERE id='condition-detail'").get())
      .toEqual({ status: "deleted", version: 2 });
    db.close();
  });
});
