import { expect, test } from "@playwright/test";

function projectSuffix(name: string) {
  return name.replaceAll(/[^a-z0-9]/giu, "_").toLowerCase();
}

test("低高度手机端始终显示建档操作按钮并允许正文滚动", async ({ page }, testInfo) => {
  const username = `onboarding_${projectSuffix(testInfo.project.name)}_${Date.now().toString(36)}`;

  await page.setExtraHTTPHeaders({ "x-forwarded-for": username });
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/login");
  await page.getByRole("button", { name: "还没有账号？创建一个" }).click();
  await page.getByLabel("称呼").fill("移动端建档测试");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill("onboarding_mobile_password_123");
  await page.getByRole("button", { name: "创建账号并登录" }).click();
  await expect(page).toHaveURL(/\/$/u);

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const nextButton = dialog.getByRole("button", { name: "下一题", exact: true });
  await expect(nextButton).toBeVisible();

  const buttonBox = await nextButton.boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(640);

  const scrollRegion = dialog.getByTestId("onboarding-content");
  const scrollMetrics = await scrollRegion.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(scrollMetrics.overflowY).toBe("auto");
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
});
