import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prepareDatabase } from "@/server/db/migration-runner";

const startResearchSearch = vi.hoisted(() => vi.fn().mockImplementation(() => ({
  searchId: "search-1",
  analysisId: "analysis-1",
  status: "RUNNING",
  completion: new Promise<never>(() => undefined),
})));
const cancelA2ATask = vi.hoisted(() => vi.fn());

vi.mock("@/server/extensions/search/service", () => ({ startResearchSearch }));
vi.mock("../task-service", () => ({
  startA2ATask: vi.fn((_clientId, _taskId) => task("working")),
  completeA2ATask: vi.fn((_clientId, _taskId, result) => ({ ...task("completed"), result })),
  cancelA2ATask,
  failA2ATask: vi.fn((_clientId, _taskId, error) => ({ ...task("failed"), error })),
  getA2ATask: vi.fn(() => task("working")),
  setA2ATaskDomainResource: vi.fn((_clientId, _taskId, type, id) => ({
    ...task("working"),
    domainResourceType: type,
    domainResourceId: id,
  })),
}));

import { runResearchCapability } from "./research";

describe("A2A research adapter", () => {
  beforeEach(() => {
    vi.stubEnv("DB_PATH", `/tmp/a2a-research-${crypto.randomUUID()}.db`);
    const db = new Database(process.env.DB_PATH!);
    prepareDatabase(db as never, process.env.DB_PATH!);
    db.prepare("INSERT INTO users (id,display_name,created_at) VALUES ('exec-1','External',?)")
      .run("2026-07-25T00:00:00.000Z");
    db.close();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("starts independent research under the execution principal without blocking", async () => {
    const result = await runResearchCapability({
      principal: { clientId: "client-1", name: "Client", capabilities: ["research_search"], rateLimitPerMinute: 60 },
      task: task("submitted"),
      context: {
        id: "context-1", externalClientId: "client-1", executionUserId: "exec-1",
        primaryCapability: "research_search", status: "ACTIVE", profile: {}, goals: [],
        portfolioInput: null, portfolioSnapshotId: null, createdAt: "", updatedAt: "", expiresAt: "",
      },
      messageId: "message-1",
      text: "AAPL risks",
      operation: "start",
      input: { query: "AAPL risks", adapters: ["WEB"], maximumResults: 10 },
      acceptedOutputModes: [],
    });

    expect(startResearchSearch).toHaveBeenCalledWith(expect.objectContaining({
      userId: "exec-1",
      signal: expect.any(AbortSignal),
    }));
    expect(result).toMatchObject({
      status: "working",
      domainResourceType: "research_search",
      domainResourceId: "search-1",
    });

  });

  it("uses the advertised cancel operation to abort and cancel the original task", async () => {
    await runResearchCapability({
      principal: { clientId: "client-1", name: "Client", capabilities: ["research_search"], rateLimitPerMinute: 60 },
      task: task("submitted", "task-original"),
      context: context(),
      messageId: "message-start",
      text: "AAPL risks",
      operation: "start",
      input: { query: "AAPL risks", adapters: ["WEB"] },
      acceptedOutputModes: [],
    });
    const signal = startResearchSearch.mock.calls.at(-1)?.[0]?.signal as AbortSignal;
    const db = new Database(process.env.DB_PATH!);
    db.prepare(`INSERT INTO research_searches
      (id,user_id,query_text,adapters_json,status,created_at)
      VALUES ('search-1','exec-1','AAPL risks','["WEB"]','running',?)`)
      .run("2026-07-25T00:00:00.000Z");
    db.close();

    await runResearchCapability({
      principal: { clientId: "client-1", name: "Client", capabilities: ["research_search"], rateLimitPerMinute: 60 },
      task: task("submitted", "task-cancel", "cancel"),
      context: context(),
      messageId: "message-cancel",
      text: "Cancel",
      operation: "cancel",
      input: { searchId: "search-1" },
      acceptedOutputModes: [],
    });

    expect(signal.aborted).toBe(true);
    expect(cancelA2ATask).toHaveBeenCalledWith("client-1", "task-original");
  });
});

function context() {
  return {
    id: "context-1", externalClientId: "client-1", executionUserId: "exec-1",
    primaryCapability: "research_search" as const, status: "ACTIVE" as const, profile: {}, goals: [],
    portfolioInput: null, portfolioSnapshotId: null, createdAt: "", updatedAt: "", expiresAt: "",
  };
}

function task(
  status: "submitted" | "working" | "completed" | "failed",
  id = "task-1",
  operation = "start",
) {
  return {
    id, externalClientId: "client-1", contextId: "context-1",
    capabilityId: "research_search" as const, operation, status,
    domainResourceType: null, domainResourceId: null, result: null, error: null,
    createdAt: "", startedAt: null, completedAt: null, events: [],
  };
}
