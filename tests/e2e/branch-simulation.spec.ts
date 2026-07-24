import { expect, test } from "@playwright/test";

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
  await page.getByRole("button", { name: "创建并开始模拟" }).click();
  await expect(page.getByText("浏览器分支实验", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "仅在模拟分支中执行" }).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("规则 fallback", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "仅在模拟分支中执行" }).nth(1).click();
  await expect(page.getByRole("button", { name: "撤回" })).toBeVisible();
  await page.getByRole("button", { name: "分支实验室" }).click();
  await expect(page.getByText("决策事件", { exact: true })).toBeVisible();
  await expect(page.getByText("父子分支差异", { exact: true })).toBeVisible();
});

test("新手没有持仓也能一键开始分支模拟", async ({ page }) => {
  const username = `starter_${Date.now()}`;
  const password = "e2e_starter_password_123";
  const registration = await page.request.post("/api/v1/auth/register", {
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
  await page.getByRole("button", { name: "用示例组合开始" }).last().click();
  await expect(page.getByText("示例组合", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "仅在模拟分支中执行" }).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("当前组合", { exact: true })).toBeVisible();
});
