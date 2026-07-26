import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/http/context";
import { authenticatedRequest, seedAuthenticatedUser } from "@tests/helpers/auth";
import { GET } from "./route";

describe("/api/v1/notifications", () => {
  const userId = "notification-route-user";

  beforeEach(() => {
    seedAuthenticatedUser({ userId });
    const db = getDatabase();
    db.prepare("DELETE FROM notifications WHERE user_id=?").run(userId);
    db.close();
  });

  it("GET returns empty notifications with filters", async () => {
    const res = await GET(authenticatedRequest(
      "http://localhost/api/v1/notifications?unreadOnly=true&severity=IMPORTANT&limit=5",
      {},
      { userId },
    ));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.items).toEqual([]);
    expect(body.data.filters).toEqual({ unreadOnly: true, severity: "IMPORTANT" });
    expect(body.meta.pagination.limit).toBe(5);
  });

  it("GET rejects invalid severity", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/notifications?severity=critical"));
    expect(res.status).toBe(400);
  });

  it("filters by source type before applying the result limit", async () => {
    const db = getDatabase();
    const insert = db.prepare(`INSERT INTO notifications
      (id,user_id,severity,title,body_text,source_type,source_id,group_key,metadata_json,
       data_as_of,dedupe_key,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    insert.run(
      "notification-route-event",
      userId,
      "information",
      "较早的关联事件",
      "event",
      "WATCHLIST_EVENT",
      "watch-item",
      "event-group",
      "{}",
      "2026-07-01T00:00:00.000Z",
      "notification-route-event",
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
    );
    for (let index = 0; index < 45; index += 1) {
      const createdAt = `2026-07-${String(25 - Math.floor(index / 24)).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00:00.000Z`;
      insert.run(
        `notification-route-newer-${index}`,
        userId,
        "important",
        `较新的非事件提醒 ${index}`,
        "non-event",
        "PORTFOLIO_RISK",
        "AAPL",
        "risk-group",
        "{}",
        createdAt,
        `notification-route-newer-${index}`,
        createdAt,
        createdAt,
      );
    }
    db.close();

    const response = await GET(authenticatedRequest(
      "http://localhost/api/v1/notifications?sourceType=WATCHLIST_EVENT&limit=40",
      {},
      { userId },
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({
      id: "notification-route-event",
      sourceType: "WATCHLIST_EVENT",
    });
    expect(body.data.filters.sourceType).toBe("WATCHLIST_EVENT");
  });
});
