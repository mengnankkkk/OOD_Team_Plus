import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/http/context";

import { runIdempotentMutation } from "./idempotency";

describe("runIdempotentMutation", () => {
  const owner = "idempotency-owner";

  beforeEach(() => {
    const db = getDatabase();
    db.prepare("DELETE FROM idempotency_records WHERE user_id=?").run(owner);
    db.prepare("DELETE FROM watchlists WHERE user_id=?").run(owner);
    db.prepare("DELETE FROM users WHERE id=?").run(owner);
    db.prepare(`INSERT INTO users
      (id,display_name,created_at)
      VALUES (?,'Idempotency','2026-07-25T00:00:00.000Z')`)
      .run(owner);
    db.close();
  });

  it("creates a resource and record atomically, then replays the value", () => {
    const mutate = (db: ReturnType<typeof getDatabase>) => {
      db.prepare(`INSERT INTO watchlists
        (id,user_id,name,status,created_at,updated_at)
        VALUES ('idem-list',?,'幂等列表','active',?,?)`)
        .run(
          owner,
          "2026-07-25T00:00:00.000Z",
          "2026-07-25T00:00:00.000Z",
        );
      return { id: "idem-list" };
    };
    const first = runIdempotentMutation(
      owner,
      "watchlist_create",
      "key-1",
      { name: "幂等列表" },
      mutate,
    );
    const second = runIdempotentMutation(
      owner,
      "watchlist_create",
      "key-1",
      { name: "幂等列表" },
      mutate,
    );

    expect(first).toEqual({ value: { id: "idem-list" }, replayed: false });
    expect(second).toEqual({ value: { id: "idem-list" }, replayed: true });
  });

  it("rolls back both records when the mutation fails", () => {
    expect(() => runIdempotentMutation(
      owner,
      "watchlist_create",
      "key-fail",
      { name: "失败" },
      (db) => {
        db.prepare(`INSERT INTO watchlists
          (id,user_id,name,status,created_at,updated_at)
          VALUES ('idem-failed-list',?,'失败列表','active',?,?)`)
          .run(
            owner,
            "2026-07-25T00:00:00.000Z",
            "2026-07-25T00:00:00.000Z",
          );
        throw new Error("mutation failed");
      },
    )).toThrow("mutation failed");

    const db = getDatabase();
    const idempotencyCount = db.prepare(`SELECT COUNT(*) AS count
      FROM idempotency_records WHERE user_id=?`).get(owner) as { count: number };
    const watchlistCount = db.prepare(`SELECT COUNT(*) AS count
      FROM watchlists WHERE id='idem-failed-list'`).get() as { count: number };
    db.close();
    expect(idempotencyCount.count).toBe(0);
    expect(watchlistCount.count).toBe(0);
  });
});
