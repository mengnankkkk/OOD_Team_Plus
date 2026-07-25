import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prepareDatabase } from "@/server/db/migration-runner";

const searchWeb = vi.hoisted(() => vi.fn());

vi.mock("./web-adapter", async (importOriginal) => {
  const original = await importOriginal<typeof import("./web-adapter")>();
  return { ...original, searchWeb };
});

import { startResearchSearch } from "./service";

describe("research search lifecycle", () => {
  let dbPath = "";

  beforeEach(() => {
    dbPath = `/tmp/research-lifecycle-${crypto.randomUUID()}.db`;
    vi.stubEnv("DB_PATH", dbPath);
    const db = new Database(dbPath);
    prepareDatabase(db as never, dbPath);
    db.prepare("INSERT INTO users (id,display_name,created_at) VALUES ('exec-1','External',?)")
      .run("2026-07-25T00:00:00.000Z");
    db.close();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("starts immediately and keeps cancellation terminal", async () => {
    searchWeb.mockImplementation(async (_query, filters: { signal?: AbortSignal }) => {
      await new Promise<void>((resolve) => {
        if (filters.signal?.aborted) return resolve();
        filters.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      return [{
        title: "late result",
        url: "https://example.com/late",
        snippet: "late",
        source: "WEB",
      }];
    });
    const controller = new AbortController();

    const started = startResearchSearch({
      userId: "exec-1",
      query: "AAPL",
      adapters: ["WEB"],
      maximumResults: 10,
      signal: controller.signal,
    });

    expect(started.status).toBe("RUNNING");
    controller.abort();
    const result = await started.completion;
    expect(result.status).toBe("CANCELED");

    const db = new Database(dbPath);
    expect(db.prepare("SELECT status FROM research_searches WHERE id=?").get(started.searchId))
      .toEqual({ status: "canceled" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM research_results WHERE search_id=?").get(started.searchId))
      .toEqual({ count: 0 });
    db.close();
  });
});
