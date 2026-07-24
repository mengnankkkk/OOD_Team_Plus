import { describe, expect, it } from "vitest";

import { checkIdempotency } from "./idempotency";

describe("checkIdempotency", () => {
  it("returns null for the stub", async () => {
    await expect(checkIdempotency("owner", "route", "key")).resolves.toBeNull();
  });
});
