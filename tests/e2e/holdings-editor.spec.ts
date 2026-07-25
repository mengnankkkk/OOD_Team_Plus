import { expect, test } from "@playwright/test";

test("资产页分别显示行业、行情单价和用户成本，并允许编辑持仓", async ({ page }) => {
  const login = await page.request.post("/api/v1/auth/login", {
    data: { username: "e2e_admin", password: "e2e_admin_password_123" },
  });
  expect(login.ok()).toBeTruthy();
  const loginBody = await login.json();
  const csrfToken = loginBody.data.csrfToken;
  await page.request.post("/api/v1/demo/bootstrap", {
    headers: { "X-CSRF-Token": csrfToken },
  });
  const onboarding = await page.request.post("/api/v1/onboarding/complete", {
    headers: { "X-CSRF-Token": csrfToken },
    data: {
      answers: {
        financial_stability: "surplus",
        emergency_reserve: "over12",
        debt_burden: "none",
        investment_experience: "some",
        investment_knowledge: "basic",
        holding_horizon: "3to5",
        loss_reaction: "hold",
        max_drawdown: "10to20",
        near_term_use: "not_needed",
      },
      profile: {
        monthlyIncome: "30000",
        monthlyExpense: "12000",
        liabilities: "0",
        emergencyTargetMonths: 6,
        investmentAmount: "100000",
        horizon: "LONG",
        maxDrawdown: "0.20",
      },
      goal: {
        name: "持仓编辑目标",
        targetAmount: "120000",
        targetDate: "2030-12-31",
        priority: "1",
        assetPreference: "STOCK",
      },
    },
  });
  expect(onboarding.ok()).toBeTruthy();

  let holding = {
    id: "holding-pingan",
    user_id: "admin-user",
    portfolio_id: "portfolio-demo",
    instrument_id: "000001.SZ",
    symbol: "000001.SZ",
    name: "平安银行",
    asset_type: "stock",
    sector: "银行",
    quantity_decimal: "100",
    cost_decimal: "10.00",
    current_price_decimal: "12.34",
    market_value_decimal: "1234",
    price_as_of: "2026-07-25T02:00:00.000Z",
    price_sources_json: JSON.stringify([{ source: "PANDADATA:get_stock_rt_daily", status: "SUCCEEDED" }]),
    version: 1,
    created_at: "2026-07-25T01:00:00.000Z",
    updated_at: "2026-07-25T01:00:00.000Z",
  };
  const fallbackHolding = {
    ...holding,
    id: "holding-fallback",
    instrument_id: "fallback-stock",
    symbol: "600000.SH",
    name: "行情待更新股票",
    sector: "银行",
    quantity_decimal: "10",
    cost_decimal: "20.00",
    current_price_decimal: "20.00",
    market_value_decimal: "200",
    price_sources_json: JSON.stringify([
      { source: "USER_HOLDINGS", status: "SUCCEEDED" },
      { source: "PREVIOUS_SNAPSHOT", status: "FALLBACK" },
    ]),
  };

  await page.route("**/api/v1/holdings", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { items: [holding, fallbackHolding] }, meta: {} }),
    });
  });
  await page.route("**/api/v1/holdings/holding-pingan", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const body = route.request().postDataJSON() as { quantity?: string; cost?: string };
    holding = {
      ...holding,
      quantity_decimal: body.quantity ?? holding.quantity_decimal,
      cost_decimal: body.cost ?? holding.cost_decimal,
      market_value_decimal: String(Number(body.quantity ?? holding.quantity_decimal) * 12.34),
      version: holding.version + 1,
      updated_at: "2026-07-25T03:00:00.000Z",
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: holding, meta: {} }),
    });
  });
  await page.route("**/api/v1/portfolio-analysis/refresh", async (route) => {
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ data: { portfolioSnapshotId: "snapshot-refreshed", dataQuality: "COMPLETE" }, meta: {} }),
    });
  });

  await page.goto("/assets");
  const row = page.getByRole("row").filter({ hasText: "平安银行" });
  await expect(row).toContainText("银行");
  await expect(row).toContainText("¥12.34");
  await expect(row).toContainText("¥10.00");
  const fallbackRow = page.getByRole("row").filter({ hasText: "行情待更新股票" });
  await expect(fallbackRow.getByText("行情待更新", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "手工录入" }).click();
  const addDialog = page.getByRole("dialog", { name: "新增持仓" });
  await expect(addDialog.getByLabel("持仓成本价")).toBeVisible();
  await expect(addDialog.getByLabel("当前单价 / 净值")).toHaveCount(0);
  await addDialog.getByRole("button", { name: "取消" }).click();

  await row.getByRole("button", { name: "编辑 平安银行" }).click();
  const dialog = page.getByRole("dialog", { name: "编辑持仓" });
  await expect(dialog.getByText("最新行情单价", { exact: true })).toBeVisible();
  await expect(dialog.getByText("¥12.34", { exact: true })).toBeVisible();
  await dialog.getByLabel("持有数量 / 份额").fill("120");
  await dialog.getByLabel("持仓成本价").fill("10.50");
  await dialog.getByRole("button", { name: "保存修改" }).click();

  await expect(row).toContainText("120");
  await expect(row).toContainText("¥12.34");
  await expect(row).toContainText("¥10.50");
});
