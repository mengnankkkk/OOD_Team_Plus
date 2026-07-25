import { expect, test } from "@playwright/test";

const recommendation = {
  id: "recommendation-today",
  analysisId: "analysis-today",
  action: "HOLD",
  status: "ACTIVE",
  summary: "维持核心仓位，并降低单一持仓集中度",
  positionRange: ["60%", "80%"],
  firstPosition: null,
  reasons: ["最大持仓权重接近风险预算上限"],
  counterEvidence: ["市场趋势仍可能延续"],
  risks: ["单一持仓波动可能放大组合回撤"],
  alternatives: ["提高现金比例"],
  invalidation: "持仓或用户资金用途发生变化",
  compliance: { status: "PASSED", reasons: [] },
  expiresAt: "2026-10-23T00:00:00.000Z",
  createdAt: "2026-07-25T00:00:00.000Z",
};

test("首页从建议卡生成今日组合建议", async ({ page }, testInfo) => {
  let generated = false;

  await page.route("**/api/v1/profile", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        id: "profile-e2e",
        status: "COMPLETED",
        riskLevel: "R3",
        preferences: {},
        hasGoal: true,
        onboardingCompleted: true,
        version: 1,
        updatedAt: "2026-07-25T00:00:00.000Z",
      },
    }),
  }));
  await page.route("**/api/v1/goals", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        items: [{
          id: "goal-e2e",
          name: "长期增值",
          targetAmount: "300000",
          currentAmount: "10500",
          targetDate: "2030-12-31",
          priority: 1,
        }],
      },
    }),
  }));
  await page.route("**/api/v1/holdings", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        items: [{
          id: "holding-e2e",
          portfolio_id: "portfolio-e2e",
          instrument_id: "AAPL",
          symbol: "AAPL",
          name: "Apple",
          asset_type: "stock",
          quantity_decimal: "2",
          cost_decimal: "140",
          current_price_decimal: "155",
          market_value_decimal: "310",
          created_at: "2026-07-25T00:00:00.000Z",
        }],
      },
    }),
  }));
  await page.route(/\/api\/v1\/recommendations(?:\/[^?]+)?(?:\?.*)?$/u, (route) => {
    const url = new URL(route.request().url());
    const isDetail = url.pathname.endsWith("/recommendation-today");
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: isDetail ? recommendation : { items: generated ? [recommendation] : [] },
      }),
    });
  });
  await page.route("**/api/v1/conversations", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        id: "conversation-today",
        title: "今日组合建议",
        created_at: "2026-07-25T00:00:00.000Z",
        updated_at: "2026-07-25T00:00:00.000Z",
        row_version: 1,
      },
    }),
  }));
  await page.route("**/api/v1/conversations/conversation-today/messages/stream", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    generated = true;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          answer: "今日组合建议已生成",
          recommendationId: "recommendation-today",
          analysis: { analysisId: "analysis-today" },
        },
      }),
    });
  });
  await page.route("**/api/v1/conversations/conversation-today/messages", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        items: [{
          id: "assistant-today",
          role: "assistant",
          content: "今日组合建议已生成",
          metadata_json: JSON.stringify({ recommendationId: "recommendation-today" }),
          agent_run_id: "analysis-today",
          created_at: "2026-07-25T00:00:00.000Z",
        }],
      },
    }),
  }));
  await page.route("**/api/v1/analyses/analysis-today/evidence-pack**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        analysis: { createdAt: "2026-07-25T00:00:00.000Z", completedAt: "2026-07-25T00:00:01.000Z" },
        agentTrace: [],
        toolCalls: [],
        skillRuns: [],
        missingEvidence: [],
        disclaimer: "仅用于研究和模拟。",
      },
    }),
  }));

  await page.goto("/login");
  await page.getByLabel("用户名").fill("e2e_admin");
  await page.getByLabel("密码").fill("e2e_admin_password_123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/$/u);

  const card = page.locator(".recommendation-card");
  await expect(card.getByRole("button", { name: "生成今日组合建议" })).toBeVisible();
  await expect(page.locator(".newsprint-masthead").getByRole("button", { name: /Agent 建议|组合建议/u })).toHaveCount(0);

  await card.getByRole("button", { name: "生成今日组合建议" }).click();
  await expect(card.getByRole("button", { name: "正在生成今日建议" })).toBeDisabled();
  await expect(card.getByRole("heading", { name: recommendation.summary })).toBeVisible();
  await expect(card.getByRole("button", { name: "更新今日建议" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("home-daily-advice.png"), fullPage: true });
});
