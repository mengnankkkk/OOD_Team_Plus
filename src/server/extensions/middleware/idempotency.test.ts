import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { beginIdempotentRequest, checkIdempotency, parseIdempotentResponse, saveIdempotentResponse } from "./idempotency";

let dbPath = "";

beforeEach(() => {
  dbPath = join(tmpdir(), `money-whisperer-idempotency-${randomUUID()}.db`);
  vi.stubEnv("DB_PATH", dbPath);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
});

describe("checkIdempotency", () => {
  it("returns null for the stub", async () => {
    await expect(checkIdempotency("owner", "route", "key")).resolves.toBeNull();
  });
});

describe("beginIdempotentRequest", () => {
  it("atomically grants one concurrent request execution rights", async () => {
    const results = await Promise.all([
      beginIdempotentRequest("owner", "route", "key", { message: "same payload" }, { reserve: true }),
      beginIdempotentRequest("owner", "route", "key", { message: "same payload" }, { reserve: true }),
    ]);

    expect(results.filter((result) => result.existing === null)).toHaveLength(1);
    const active = results.find((result) => result.existing !== null)?.existing;
    expect(active).toMatchObject({ active: true, conflict: false });
  });

  it("replays the completed response after a reservation is saved", async () => {
    const started = await beginIdempotentRequest("owner", "route", "key", { message: "same payload" }, { reserve: true });
    const response = { data: { id: "resource-1" } };

    await saveIdempotentResponse("owner", "route", "key", started.requestHash, response);
    const replay = await beginIdempotentRequest("owner", "route", "key", { message: "same payload" }, { reserve: true });

    expect(replay.existing).toMatchObject({ active: false, conflict: false });
    expect(parseIdempotentResponse(replay.existing!)).toEqual(response);
  });

  it("keeps a different payload as an idempotency conflict", async () => {
    await beginIdempotentRequest("owner", "route", "key", { message: "first payload" }, { reserve: true });

    const conflicting = await beginIdempotentRequest("owner", "route", "key", { message: "different payload" }, { reserve: true });

    expect(conflicting.existing).toMatchObject({ active: false, conflict: true });
  });

  it("preserves query-only behavior unless reservation is requested", async () => {
    const first = await beginIdempotentRequest("owner", "route", "key", { message: "same payload" });
    const second = await beginIdempotentRequest("owner", "route", "key", { message: "same payload" });

    expect(first.existing).toBeNull();
    expect(second.existing).toBeNull();
    await expect(checkIdempotency("owner", "route", "key")).resolves.toBeNull();
  });
});
