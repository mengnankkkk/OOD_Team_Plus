import { expect, test } from "@playwright/test";

function projectSuffix(name: string) {
  return name.replaceAll(/[^a-z0-9]/giu, "_").toLowerCase();
}

test("完整用户业务闭环", async ({ page }, testInfo) => {
  const username = `investor_${projectSuffix(testInfo.project.name)}`;
  const password = "e2e_investor_password_123";

  await page.goto("/login");
  await page.getByRole("button", { name: "还没有账号？创建一个" }).click();
  await page.getByLabel("称呼").fill("端到端投资者");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "创建账号并登录" }).click();
  await expect(page).toHaveURL(/\/$/u);

  const onboarding = page.getByRole("dialog");
  await expect(onboarding).toBeVisible();
  const riskAnswers = [
    "收入稳定，扣除日常支出后仍有明显结余",
    "12 个月以上",
    "没有负债，或还款压力很低",
    "几乎没有投资经验",
    "基本不了解，希望从简单的方案开始",
    "3-5 年内可能使用",
    "继续持有，等待市场恢复",
    "10%-20%",
    "没有，资金可以长期投资",
  ];
  for (const answer of riskAnswers) {
    await onboarding.getByRole("button", { name: answer }).click();
    await onboarding.getByRole("button", { name: /下一题|进入下一步/u }).click();
  }
  await onboarding.getByLabel("月度收入（元）").fill("30000");
  await onboarding.getByLabel("月度必要支出（元）").fill("12000");
  await onboarding.getByLabel("负债余额（元）").fill("0");
  await onboarding.getByLabel("本次计划投资金额（元）").fill("50000");
  await onboarding.getByRole("button", { name: "进入下一步" }).click();
  await onboarding.getByLabel("目标金额（元）").fill("300000");
  await onboarding.getByLabel("目标日期").fill("2030-12-31");
  await onboarding.getByRole("button", { name: "进入下一步" }).click();
  await onboarding.getByLabel("标的名称").fill("Apple");
  await onboarding.getByLabel("代码").fill("AAPL");
  await onboarding.getByLabel("持有数量 / 份额").fill("2");
  await onboarding.getByLabel("持仓成本价").fill("140");
  await onboarding.getByRole("button", { name: "完成建档并进入工作台" }).click();
  await expect(onboarding).toBeHidden();

  await page.goto("/profile");
  await page.getByLabel("月度收入（元）").fill("30000");
  await page.getByLabel("月度必要支出（元）").fill("12000");
  await page.getByLabel("负债余额（元）").fill("0");
  await page.getByLabel("补充说明（可选）").fill("最大可接受回撤 15%，计划持有三年，偏好宽基指数和优质个股。");
  await page.getByRole("button", { name: "保存财务档案" }).click();
  await expect(page.getByText("财务档案已保存")).toBeVisible();

  await page.goto("/assets");
  await expect(page.getByText("Apple", { exact: true })).toBeVisible();

  await page.goto("/query");
  await page.getByLabel("查数问题").fill("列出我的持仓代码、数量、市值和浮盈亏");
  await page.getByRole("button", { name: /执行查询/u }).click();
  await expect(page.getByText("QUERY RESULT")).toBeVisible();
  await expect(page.getByRole("link", { name: "查看生成产物" })).toBeVisible();
  await page.getByRole("link", { name: "查看生成产物" }).click();
  await expect(page).toHaveURL(/\/artifacts/u);

  await page.goto("/simulations");
  await page.getByLabel("新实验名称").fill("E2E 组合实验");
  await page.locator("form.create-workspace").getByRole("button", { name: "用我的持仓开始" }).click();
  await expect(page.getByText("E2E 组合实验", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "仅在模拟分支中执行" }).first()).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "仅在模拟分支中执行" }).first().click();
  await expect(page.getByRole("button", { name: "撤回到父分支" })).toBeVisible();

  await page.goto("/advisor");
  const advisorPrompt = "请诊断当前组合健康度、集中度和压力情景，并给出支持证据与反方证据。";
  await page.getByPlaceholder("发消息…").fill(advisorPrompt);
  await page.getByPlaceholder("发消息…").press("Control+Enter");
  await expect(page.getByText(/建议状态：(ACTIVE|DEGRADED)/u)).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "新对话" }).click();
  const newConversationPrompt = "新对话回归测试：请总结当前最重要的一条理财原则。";
  await page.getByPlaceholder("发消息…").fill(newConversationPrompt);
  await page.getByPlaceholder("发消息…").press("Control+Enter");
  const activeConversation = page.locator("section");
  await expect(activeConversation.getByText(advisorPrompt, { exact: true })).toHaveCount(0);
  await expect(activeConversation.getByText(newConversationPrompt, { exact: true })).toBeVisible();
  await expect(activeConversation.getByText(/建议状态：(ACTIVE|DEGRADED)/u)).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: testInfo.outputPath("user-business-flow.png"), fullPage: true });
});

test("完整管理员业务闭环", async ({ page }, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("用户名").fill("e2e_admin");
  await page.getByLabel("密码").fill("e2e_admin_password_123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/$/u);

  await page.goto("/admin/system");
  await expect(page.getByRole("heading", { name: "系统健康" })).toBeVisible();
  await expect(page.getByText(/READY|DEGRADED|NOT_READY/u).first()).toBeVisible();

  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();
  await expect(page.getByText("e2e_admin", { exact: false }).first()).toBeVisible();

  await page.goto("/assets/semantic");
  await expect(page.getByText("语义层", { exact: false }).first()).toBeVisible();

  await page.goto("/admin/rss");
  const feedName = `E2E RSS ${testInfo.project.name}`;
  await page.getByPlaceholder("来源名称").fill(feedName);
  await page.getByPlaceholder("https://example.com/feed.xml").fill(`https://example.com/${projectSuffix(testInfo.project.name)}.xml`);
  await page.getByRole("button", { name: "添加" }).click();
  await expect(page.getByText(feedName, { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("admin-business-flow.png"), fullPage: true });
});
