import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
});

test("C 端可以完成分支模拟决策流", async ({ page }) => {
  const username = process.env.E2E_USERNAME ?? "e2e_admin";
  const password = process.env.E2E_PASSWORD ?? "e2e_admin_password_123";
  const login = await page.request.post("/api/v1/auth/login", { data: { username, password } });
  expect(login.ok()).toBeTruthy();
  const loginBody = await login.json();
  const csrfToken = loginBody.data.csrfToken;
  const bootstrap = await page.request.post("/api/v1/demo/bootstrap", { headers: { "X-CSRF-Token": csrfToken } });
  expect(bootstrap.ok()).toBeTruthy();
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
      profile: { monthlyIncome: "30000", monthlyExpense: "12000", liabilities: "0", emergencyTargetMonths: 6, investmentAmount: "100000", horizon: "LONG", maxDrawdown: "0.20" },
      goal: { name: "分支实验目标", targetAmount: "120000", targetDate: "2030-12-31", priority: "1", assetPreference: "INDEX" },
    },
  });
  expect(onboarding.ok()).toBeTruthy();

  await page.goto("/simulations");
  await page.getByLabel("新实验名称").fill("浏览器分支实验");
  await page.locator("form.create-workspace").getByRole("button", { name: "用我的持仓开始" }).click();
  await expect(page.getByText("浏览器分支实验", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "仅在模拟分支中执行" }).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("规则 fallback", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "仅在模拟分支中执行" }).nth(1).click();
  await expect(page.getByRole("button", { name: "撤回" })).toBeVisible();
  await page.getByRole("button", { name: "分支实验室" }).click();
  await expect(page.getByText("决策事件", { exact: true })).toBeVisible();
  await expect(page.getByText("父子分支差异", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新建实验工作区" }).click();
  await expect(page.getByRole("button", { name: "撤回", exact: true })).toHaveCount(0);
  await expect(page.getByText("用 1 分钟体验一次“如果我这样买，会发生什么？”", { exact: true })).toBeVisible();
});

test("新手没有持仓也能一键开始分支模拟", async ({ page }) => {
  const username = `starter_${Date.now()}`;
  const password = "e2e_starter_password_123";
  const registration = await page.request.post("/api/v1/auth/register", {
    headers: { "x-forwarded-for": username },
    data: { username, password, displayName: "分支模拟新手" },
  });
  expect(registration.ok()).toBeTruthy();
  const registrationBody = await registration.json();
  const csrfToken = registrationBody.data.csrfToken;
  const onboarding = await page.request.post("/api/v1/onboarding/complete", {
    headers: { "X-CSRF-Token": csrfToken },
    data: {
      answers: {
        financial_stability: "surplus",
        emergency_reserve: "over12",
        debt_burden: "none",
        investment_experience: "none",
        investment_knowledge: "basic",
        holding_horizon: "3to5",
        loss_reaction: "hold",
        max_drawdown: "10to20",
        near_term_use: "not_needed",
      },
      profile: { monthlyIncome: "20000", monthlyExpense: "9000", liabilities: "0", emergencyTargetMonths: 6, investmentAmount: "50000", horizon: "LONG", maxDrawdown: "0.20" },
      goal: { name: "第一次投资练习", targetAmount: "80000", targetDate: "2030-12-31", priority: "1", assetPreference: "INDEX" },
    },
  });
  expect(onboarding.ok()).toBeTruthy();

  await page.goto("/simulations");
  await expect(page.getByText("还没有录入持仓", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "分支实验室" }).click();
  await expect(page.getByText("分支实验室会记录每一次选择", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "决策流" }).click();
  await expect(page.getByText("用 1 分钟体验一次“如果我这样买，会发生什么？”", { exact: true })).toBeVisible();
  await page.locator("form.create-workspace").getByRole("button", { name: "用示例组合开始" }).click();
  await expect(page.getByText("示例组合", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "新建实验工作区" }).click();
  await expect(page.getByLabel("新实验名称")).toBeFocused();
  await expect(page.getByText("用 1 分钟体验一次“如果我这样买，会发生什么？”", { exact: true })).toBeVisible();
  await page.locator("form.create-workspace").getByRole("button", { name: "用示例组合开始" }).click();
  await expect(page.getByRole("button", { name: "仅在模拟分支中执行" }).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("当前组合", { exact: true })).toBeVisible();
});

test("录入真实持仓后新实验会改用我的持仓", async ({ page }) => {
  const username = `real_holdings_${Date.now()}`;
  const password = "e2e_real_holdings_password_123";
  const registration = await page.request.post("/api/v1/auth/register", {
    headers: { "x-forwarded-for": username },
    data: { username, password, displayName: "真实持仓用户" },
  });
  expect(registration.ok()).toBeTruthy();
  const registrationBody = await registration.json();
  const csrfToken = registrationBody.data.csrfToken;
  const onboarding = await page.request.post("/api/v1/onboarding/complete", {
    headers: { "X-CSRF-Token": csrfToken },
    data: {
      answers: {
        financial_stability: "surplus",
        emergency_reserve: "over12",
        debt_burden: "none",
        investment_experience: "none",
        investment_knowledge: "basic",
        holding_horizon: "3to5",
        loss_reaction: "hold",
        max_drawdown: "10to20",
        near_term_use: "not_needed",
      },
      profile: { monthlyIncome: "20000", monthlyExpense: "9000", liabilities: "0", emergencyTargetMonths: 6, investmentAmount: "50000", horizon: "LONG", maxDrawdown: "0.20" },
      goal: { name: "真实持仓练习", targetAmount: "80000", targetDate: "2030-12-31", priority: "1", assetPreference: "STOCK" },
    },
  });
  expect(onboarding.ok()).toBeTruthy();

  await page.goto("/simulations");
  await page.locator("form.create-workspace").getByRole("button", { name: "用示例组合开始" }).click();
  await expect(page.getByText("示例组合", { exact: true }).first()).toBeVisible();

  await page.goto("/assets");
  await expect(page.getByRole("button", { name: "手工录入" })).toBeInViewport();
  await page.getByRole("button", { name: "手工录入" }).click();
  await page.getByLabel("标的名称").fill("Apple");
  await page.getByLabel("代码（可选）").fill("AAPL");
  await page.getByLabel("持有数量 / 份额").fill("2");
  await page.getByLabel("持仓成本价").fill("140");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("Apple", { exact: true })).toBeVisible();

  await page.goto("/simulations");
  await expect(page.getByText("已连接你的持仓", { exact: true })).toBeVisible();
  await expect(page.getByText("还没有录入持仓", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "新建实验工作区" }).click();
  await page.getByLabel("新实验名称").fill("我的真实持仓实验");
  await page.locator("form.create-workspace").getByRole("button", { name: "用我的持仓开始" }).click();
  await expect(page.getByText("我的真实持仓实验", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("我的持仓", { exact: true }).first()).toBeVisible();
});
