import { expect, test } from "@playwright/test";

import {
  assertMobileOverlayWidth,
  mockWatchlistAlerts,
  prepareWatchlistUser,
} from "./watchlist-observation.helpers";

test.beforeEach(async ({ page }, testInfo) => {
  const isMobileProject = testInfo.project.name.startsWith("mobile");
  const isMobileTest = testInfo.title.startsWith("mobile ");
  if (isMobileProject !== isMobileTest) return;
  await prepareWatchlistUser(page, testInfo.project.name.startsWith("mobile"));
});

test("desktop users can manage the complete watchlist observation workflow", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("desktop"), "Desktop workflow");
  await page.goto("/watchlist");
  await expect(page.getByRole("heading", { name: "持仓观测" })).toBeVisible();

  await page.getByRole("button", { name: "管理列表" }).click();
  const manager = page.getByRole("dialog", { name: "管理观察列表" });
  await manager.getByRole("button", { name: "新建列表" }).click();
  await manager.getByLabel("列表名称").fill("长期研究");
  await manager.getByLabel("列表说明").fill("用于跟踪长期复利候选标的");
  await manager.getByRole("button", { name: "创建列表" }).click();
  await expect(manager.getByText("长期研究", { exact: true })).toBeVisible();
  await manager.getByRole("button", { name: "完成" }).click();

  await page.getByRole("button", { name: "添加标的" }).click();
  const editor = page.getByRole("dialog", { name: "添加观察对象" });
  await editor.getByPlaceholder("输入代码或名称，例如 600519 / 贵州茅台").fill("600519");
  await editor.getByRole("button", { name: /贵州茅台/u }).click();
  await editor.getByLabel("关注理由").fill("品牌护城河稳定，等待估值与基本面同时进入观察区间");
  await editor.getByLabel("计划期限").fill("3-5 年");
  await editor.getByLabel("关联目标").click();
  await page.getByRole("option", { name: "长期财富目标" }).click();
  await editor.getByLabel("初始回撤阈值 (%)").fill("12");
  await editor.getByRole("button", { name: "保存观察对象" }).click();

  const card = page.getByRole("article", { name: /贵州茅台/u });
  await expect(card).toBeVisible();
  await expect(
    card.locator(".watchlist-card-title-row").getByText("未持有", { exact: true }),
  ).toBeVisible();
  await expect(card.getByText("长期财富目标", { exact: true })).toBeVisible();
  await expect(card.getByText(/近 20 日回撤达到 12%/u)).toBeVisible();

  await page.getByRole("button", { name: "添加标的" }).click();
  const duplicateEditor = page.getByRole("dialog", { name: "添加观察对象" });
  await duplicateEditor.getByPlaceholder("输入代码或名称，例如 600519 / 贵州茅台").fill("600519");
  await duplicateEditor.getByRole("button", { name: /贵州茅台/u }).click();
  await duplicateEditor.getByRole("button", { name: "保存观察对象" }).click();
  await expect(page.getByText(/已在当前观察列表中/u)).toBeVisible();
  await duplicateEditor.getByRole("button", { name: "取消" }).click();

  await card.getByRole("button", { name: "编辑观察信息" }).click();
  const editDialog = page.getByRole("dialog", { name: "编辑观察对象" });
  await editDialog.getByLabel("关注理由").fill("品牌护城河稳定，重点观察现金流与渠道库存");
  await editDialog.getByRole("button", { name: "保存修改" }).click();
  await expect(card.getByText("重点观察现金流与渠道库存", { exact: false })).toBeVisible();

  await card.getByRole("button", { name: "管理提醒规则" }).click();
  const conditionSheet = page.getByRole("dialog", { name: "贵州茅台提醒规则" });
  await conditionSheet.getByRole("button", { name: "新建规则" }).click();
  await conditionSheet.getByLabel("规则类型").click();
  await page.getByRole("option", { name: "价格低于" }).click();
  await conditionSheet.getByLabel("价格阈值").fill("1200");
  await conditionSheet.getByRole("button", { name: "保存规则" }).click();
  const priceRule = conditionSheet.getByText("价格低于 ¥1,200", { exact: false }).locator("..");
  await expect(priceRule).toBeVisible();
  await priceRule.getByRole("button", { name: "暂停规则" }).click();
  await expect(priceRule.getByText("已暂停", { exact: true })).toBeVisible();
  await priceRule.getByRole("button", { name: "启用规则" }).click();
  await expect(priceRule.getByText("已启用", { exact: true })).toBeVisible();
  await conditionSheet.getByRole("button", { name: "关闭" }).click();

  await card.getByRole("button", { name: "立即检查" }).click();
  const lastChecked = page.getByRole("region", { name: "观察列表概况" })
    .getByText("最近检查")
    .locator("..");
  await expect(lastChecked.getByText("尚未检查", { exact: true })).toHaveCount(0);

  await card.getByRole("button", { name: "移动到其他列表" }).click();
  const moveDialog = page.getByRole("dialog", { name: "移动观察对象" });
  await moveDialog.getByLabel("目标列表").click();
  await page.getByRole("option", { name: "长期研究" }).click();
  await moveDialog.getByRole("button", { name: "确认移动" }).click();
  await expect(card).toHaveCount(0);

  await page.getByLabel("当前观察列表").click();
  await page.getByRole("option", { name: "长期研究" }).click();
  const movedCard = page.getByRole("article", { name: /贵州茅台/u });
  await expect(movedCard).toBeVisible();
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  await page.screenshot({
    path: "artifacts/watchlist-observation-desktop.png",
    fullPage: true,
  });
  await movedCard.getByRole("button", { name: "问顾问" }).click();
  await expect(page).toHaveURL(/\/advisor\?prompt=/u);
  await expect(page.getByPlaceholder("发消息…")).toHaveValue(/贵州茅台.*现金流.*长期财富目标/u);
});

test("desktop users can filter and manage watchlist alerts", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("desktop"), "Desktop alert workflow");
  await mockWatchlistAlerts(page);

  await page.goto("/alerts");
  await expect(page.getByRole("heading", { name: "提醒中心" })).toBeVisible();
  await expect(
    page.getByRole("article").filter({ hasText: "贵州茅台出现单日异动" })
      .getByText("自选异动", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("article").filter({ hasText: "贵州茅台触及回撤线" })
      .getByText("自选回撤", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("article").filter({ hasText: "贵州茅台新闻事件" })
      .getByText("关联事件", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("article").filter({ hasText: "贵州茅台价格条件触发" })
      .getByText("自定义条件", { exact: true }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "关联事件" }).click();
  const eventAlert = page.getByRole("article").filter({ hasText: "贵州茅台新闻事件" });
  await expect(eventAlert).toBeVisible();
  await expect(page.getByRole("heading", { name: "贵州茅台出现单日异动" })).toHaveCount(0);
  await eventAlert.getByRole("button", { name: "标记已读" }).click();
  await expect(eventAlert.getByRole("button", { name: "标记已读" })).toHaveCount(0);
  await eventAlert.getByRole("button", { name: "忽略提醒" }).click();
  await expect(eventAlert).toHaveCount(0);
});

test("mobile users can switch lists and use full-width watchlist editors", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "Mobile workflow");
  await page.goto("/watchlist");
  await expect(page.getByRole("heading", { name: "持仓观测" })).toBeVisible();

  await page.getByRole("button", { name: "管理列表" }).click();
  const manager = page.getByRole("dialog", { name: "管理观察列表" });
  await assertMobileOverlayWidth(page, manager);
  await manager.getByRole("button", { name: "新建列表" }).click();
  await manager.getByLabel("列表名称").fill("移动观察");
  await manager.getByRole("button", { name: "创建列表" }).click();
  await expect(manager.getByText("移动观察", { exact: true })).toBeVisible();
  await manager.getByRole("button", { name: "完成" }).click();

  await page.getByRole("button", { name: "添加标的" }).click();
  const editor = page.getByRole("dialog", { name: "添加观察对象" });
  await assertMobileOverlayWidth(page, editor);
  await editor.getByPlaceholder("输入代码或名称，例如 600519 / 贵州茅台").fill("600519");
  await editor.getByRole("button", { name: /贵州茅台/u }).click();
  await editor.getByLabel("关注理由").fill("移动端持续观察现金流和渠道库存");
  await editor.getByRole("button", { name: "保存观察对象" }).click();

  const card = page.getByRole("article", { name: /贵州茅台/u });
  await expect(card).toBeVisible();
  const askAdvisor = card.getByRole("button", { name: "问顾问" });
  await expect(askAdvisor).toBeVisible();
  expect((await askAdvisor.boundingBox())?.width).toBeGreaterThan(180);
  for (const label of ["立即检查", "编辑观察信息", "管理提醒规则", "移动到其他列表", "移除观察对象"]) {
    await expect(card.getByRole("button", { name: label })).toBeVisible();
  }
  await card.getByRole("button", { name: "管理提醒规则" }).click();
  const conditionSheet = page.getByRole("dialog", { name: "贵州茅台提醒规则" });
  await expect(conditionSheet).toBeVisible();
  await assertMobileOverlayWidth(page, conditionSheet);
  await conditionSheet.getByRole("button", { name: "关闭" }).click();

  await page.getByLabel("当前观察列表").click();
  await page.getByRole("option", { name: "移动观察" }).click();
  await expect(page.getByText("当前列表还没有观察对象", { exact: true })).toBeVisible();
  await page.getByLabel("当前观察列表").click();
  await page.getByRole("option", { name: /持仓观测/u }).click();
  await expect(card).toBeVisible();

  await expect.poll(() => page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))).toEqual(expect.objectContaining({
    clientWidth: testInfo.project.use.viewport?.width,
    scrollWidth: testInfo.project.use.viewport?.width,
  }));
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  await page.screenshot({
    path: "artifacts/watchlist-observation-mobile.png",
    fullPage: true,
  });
});
