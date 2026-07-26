import { beforeEach, describe, expect, it } from "vitest";

import { hashIdempotencyRequest } from "./idempotency";
import { runIdempotentAsync } from "./idempotency-async";
import { getDatabase } from "@/server/http/context";

describe("runIdempotentAsync", () => {
  beforeEach(() => {
    const db = getDatabase();
    db.prepare("DELETE FROM idempotency_records WHERE user_id='async-idem-user'").run();
    db.close();
  });

  it("reclaims a stale pending reservation after a crashed owner", async () => {
    const body = { value: 1 };
    const db = getDatabase();
    db.prepare(`INSERT INTO idempotency_records
      (id,user_id,operation,idempotency_key,resource_id,response_json,request_hash,created_at)
      VALUES ('async-stale','async-idem-user','async-test','stale-key','pending','',?,
        '2020-01-01T00:00:00.000Z')`)
      .run(hashIdempotencyRequest(body));
    db.close();
    let mutations = 0;

    const result = await runIdempotentAsync(
      "async-idem-user",
      "async-test",
      "stale-key",
      body,
      async () => ({ resourceId: `resource-${++mutations}` }),
      { staleAfterMs: 0 },
    );

    expect(result).toEqual({
      value: { resourceId: "resource-1" },
      replayed: false,
    });
    expect(mutations).toBe(1);
  });
});
