import { expect, test } from "@playwright/test";

test("资产页模糊搜索不会让远端 ETF 挤掉本地 A 股结果", async ({ page }) => {
  const login = await page.request.post("/api/v1/auth/login", {
    data: { username: "e2e_admin", password: "e2e_admin_password_123" },
  });
  expect(login.ok()).toBeTruthy();
  const loginBody = await login.json();
  const csrfToken = loginBody.data.csrfToken;

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
        name: "搜索回归目标",
        targetAmount: "120000",
        targetDate: "2030-12-31",
        priority: "1",
        assetPreference: "STOCK",
      },
    },
  });
  expect(onboarding.ok()).toBeTruthy();

  const remoteItems = Array.from({ length: 12 }, (_, index) => ({
    instrumentId: `fund-${index}`,
    symbol: `51${String(index).padStart(4, "0")}`,
    name: `平安主题ETF${index}`,
    market: "SH",
    assetType: "INDEX",
    sector: null,
    tradable: true,
  }));
  const requestedCursors: string[] = [];
  await page.route("**/api/v1/instruments/search?**", async (route) => {
    const url = new URL(route.request().url());
    const cursor = url.searchParams.get("cursor") ?? "0";
    const offset = Number.parseInt(cursor, 10);
    const limit = Number.parseInt(url.searchParams.get("limit") ?? "8", 10);
    const items = remoteItems.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    const hasMore = nextOffset < remoteItems.length;
    requestedCursors.push(cursor);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          items,
          pagination: {
            limit,
            nextCursor: hasMore ? String(nextOffset) : null,
            hasMore,
            total: remoteItems.length,
          },
        },
        meta: {},
      }),
    });
  });

  await page.goto("/assets");
  await page.getByRole("button", { name: "手工录入" }).click();
  const dialog = page.getByRole("dialog", { name: "新增持仓" });
  await dialog.getByPlaceholder("输入代码或名称，例如 600519 / 贵州茅台").fill("平安");

  await expect(dialog.getByText("平安主题ETF0", { exact: true })).toBeVisible();
  await expect(dialog.getByText("平安银行", { exact: true })).toBeVisible();
  await expect(dialog.getByText("000001", { exact: true })).toBeVisible();

  const loadMore = dialog.getByRole("button", { name: "加载更多" });
  await expect(loadMore).toBeVisible();
  await loadMore.click();
  await expect(dialog.getByText("平安主题ETF7", { exact: true })).toBeVisible();
  await loadMore.click();
  await expect(dialog.getByText("平安主题ETF11", { exact: true })).toBeVisible();
  await expect(loadMore).toHaveCount(0);
  expect(requestedCursors).toEqual(["0", "8"]);
});
