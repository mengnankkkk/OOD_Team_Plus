import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateQueryPlan } from "./plan-generator";

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
    expect(result.sql).toContain("user_id = 'user1'");
    expect(fetch).toHaveBeenCalledWith(
      "https://api.deepseek.com/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("injects account scope and escapes security values", async () => {
    mockPlan(basePlan);

    const result = await generateQueryPlan(
      "q",
      ["portfolio_snapshots"],
      ["acc1", "acc'2"],
      "user'abc",
    );

    expect(result.sql).toContain("user_id = 'user''abc'");
    expect(result.sql).toContain("account_id IN ('acc1','acc''2')");
  });

  it("adds sanitized filters and ordering", async () => {
    mockPlan({
      ...basePlan,
      filters: [{ column: "status", operator: "eq", value: "active' OR 1=1" }],
      orderBy: "account_id DESC",
    });

    const result = await generateQueryPlan("q", ["portfolio_snapshots"], null, "user1");

    expect(result.sql).toContain("status = 'active'' OR 1=1'");
    expect(result.sql).toContain("ORDER BY account_id DESC");
  });

  it("rejects datasets that were not requested", async () => {
    mockPlan({ ...basePlan, datasets: ["instruments"] });

    await expect(
      generateQueryPlan("q", ["portfolio_snapshots"], null, "user1"),
    ).rejects.toThrow("No valid tables");
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

  it("throws when the DeepSeek API key is missing", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");

    await expect(
      generateQueryPlan("q", ["portfolio_snapshots"], null, "user1"),
    ).rejects.toThrow("DEEPSEEK_API_KEY");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("throws a status-only error when DeepSeek fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 503 } as Response);

    await expect(
      generateQueryPlan("q", ["portfolio_snapshots"], null, "user1"),
    ).rejects.toThrow("DeepSeek API error: 503");
  });
});
