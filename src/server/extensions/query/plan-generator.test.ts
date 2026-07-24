import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

import { generateQueryPlan } from "./plan-generator";
import { ensureRuntimeSchema } from "@/server/db/runtime-schema";
import { prepareDatabase } from "@/server/db/migration-runner";

vi.stubGlobal("fetch", vi.fn());

const basePlan = {
  datasets: ["portfolio_snapshots"],
  dimensions: [] as string[],
  metrics: ["COUNT(*)"],
  filters: [] as Array<{ column: string; operator: string; value: string | string[] }>,
  limit: 10,
};

function mockPlan(plan: object): void {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(plan) } }] }),
  } as Response);
}

describe("generateQueryPlan", () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset();
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_API_URL", "https://api.deepseek.com/v1/chat/completions");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("calls DeepSeek and returns a plan with scoped SQL", async () => {
    mockPlan({ ...basePlan, dimensions: ["account_id"], limit: 100 });

    const result = await generateQueryPlan(
      "count my accounts",
      ["portfolio_snapshots"],
      null,
      "user1",
    );

    expect(result.plan.limit).toBe(100);
    expect(result.sql).toContain("portfolio_snapshots");
    expect(result.sql).toContain("ps.user_id = ?");
    expect(result.parameters).toEqual(["user1"]);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.deepseek.com/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("binds user and account scope as parameters", async () => {
    mockPlan(basePlan);

    const result = await generateQueryPlan(
      "q",
      ["portfolio_snapshots"],
      ["acc1", "acc'2"],
      "user'abc",
    );

    expect(result.sql).toContain("ps.user_id = ?");
    expect(result.sql).toContain("ps.portfolio_id IN (?, ?)");
    expect(result.parameters).toEqual(["user'abc", "acc1", "acc'2"]);
  });

  it("adds sanitized filters and ordering", async () => {
    mockPlan({
      ...basePlan,
      filters: [{ column: "data_quality", operator: "eq", value: "active' OR 1=1" }],
      orderBy: "account_id DESC",
    });

    const result = await generateQueryPlan("q", ["portfolio_snapshots"], null, "user1");

    expect(result.sql).toContain("ps.data_quality = ?");
    expect(result.sql).toContain("ORDER BY ps.portfolio_id DESC");
    expect(result.parameters).toEqual(["user1", "active' OR 1=1"]);
  });

  it("rejects datasets that were not requested", async () => {
    mockPlan({ ...basePlan, datasets: ["instruments"] });

    await expect(
      generateQueryPlan("q", ["portfolio_snapshots"], null, "user1"),
    ).rejects.toThrow("dataset that was not requested");
  });

  it("rejects injected identifiers and metrics", async () => {
    mockPlan({ ...basePlan, dimensions: ["account_id; DROP TABLE users"] });
    await expect(
      generateQueryPlan("q", ["portfolio_snapshots"], null, "user1"),
    ).rejects.toThrow("Invalid query plan identifier");

    mockPlan({ ...basePlan, metrics: ["COUNT(*); DROP TABLE users"] });
    await expect(
      generateQueryPlan("q", ["portfolio_snapshots"], null, "user1"),
    ).rejects.toThrow("Invalid query plan metric");
  });

  it("uses the default limit when the model omits it", async () => {
    const planWithoutLimit = {
      datasets: basePlan.datasets,
      dimensions: basePlan.dimensions,
      metrics: basePlan.metrics,
      filters: basePlan.filters,
    };
    mockPlan(planWithoutLimit);

    const result = await generateQueryPlan("q", ["portfolio_snapshots"], null, "user1");

    expect(result.plan.limit).toBe(2_000);
    expect(result.sql).toContain("LIMIT 2000");
  });

  it("uses deterministic QueryPlan fallback when the model key is missing", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");

    const result = await generateQueryPlan("q", ["portfolio_snapshots"], null, "user1");
    expect(result.planner).toBe("DETERMINISTIC_FALLBACK");
    expect(result.parameters).toEqual(["user1"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("routes market datasets through a documented PandaData method", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");

    const result = await generateQueryPlan(
      "show 000001.SZ daily prices",
      ["MARKET_STOCK_DAILY"],
      null,
      "user1",
      100,
    );

    expect(result.sql).toBeNull();
    expect(result.pandaSources).toEqual([
      expect.objectContaining({
        dataset: "MARKET_STOCK_DAILY",
        method: "get_stock_daily",
        parameters: expect.objectContaining({ symbol: ["000001.SZ"] }),
      }),
    ]);
    expect(result.plan.sources?.[0]).toEqual(expect.objectContaining({
      kind: "PANDADATA",
      method: "get_stock_daily",
    }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps local SQL and PandaData sources in one cross-source QueryPlan", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");

    const result = await generateQueryPlan(
      "show my holding and 000001.SZ daily price",
      ["PORTFOLIO_HOLDINGS", "MARKET_STOCK_DAILY"],
      null,
      "user1",
      100,
    );

    expect(result.sql).toContain("holding_snapshots");
    expect(result.parameters[0]).toBe("user1");
    expect(result.plan.datasets).toEqual(["PORTFOLIO_HOLDINGS", "MARKET_STOCK_DAILY"]);
    expect(result.plan.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "SQLITE" }),
      expect.objectContaining({ kind: "PANDADATA", method: "get_stock_daily" }),
    ]));
  });

  it("maps managed semantic column names to trusted catalog expressions", async () => {
    const database = new Database(":memory:");
    ensureRuntimeSchema(database as never);
    prepareDatabase(database as never, ":memory:");
    const now = new Date().toISOString();
    database.prepare("INSERT INTO metadata_domains (id,name,is_visible,status,created_at,updated_at) VALUES ('domain1','证券研究',1,'active',?,?)").run(now, now);
    database.prepare(`INSERT INTO metadata_semantic_tables
      (id,domain_id,datasource_key,physical_table_name,semantic_name,is_visible,status,sync_status,created_at,updated_at)
      VALUES ('table1','domain1','sqlite','instruments','证券主数据',1,'active','active',?,?)`).run(now, now);
    database.prepare(`INSERT INTO metadata_semantic_columns
      (id,table_id,physical_column_name,ordinal_position,data_type,semantic_name,is_visible,status,sync_status,created_at,updated_at)
      VALUES ('column1','table1','symbol',1,'TEXT','证券代码',1,'active','active',?,?)`).run(now, now);
    mockPlan({ ...basePlan, datasets: ["INSTRUMENTS"], dimensions: ["证券代码"], metrics: [] });

    const result = await generateQueryPlan("列出证券代码", ["INSTRUMENTS"], null, "user1", 100, database as never);

    expect(result.plan.dimensions).toEqual(["symbol"]);
    expect(result.sql).toContain('i.symbol AS "symbol"');
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(request.messages[1].content).toContain("证券主数据");
    database.close();
  });

  it("throws a status-only error when DeepSeek fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 503 } as Response);

    await expect(
      generateQueryPlan("q", ["portfolio_snapshots"], null, "user1"),
    ).rejects.toThrow("DeepSeek API error: 503");
  });
});
