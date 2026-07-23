import { expect, test } from "@playwright/test";

test("Supervisor delegates, remembers, and restores the session", async ({ page }) => {
  await page.goto("/");
  const prompt =
    "请记住演示口令是琥珀灯。请分别调用 Explorer 用一句话分析它，再调用 Reviewer 用一句话复核，然后用三句话给我最终答复。";
  await page.getByLabel("输入消息").fill(prompt);
  await page.getByLabel("发送消息").click();

  await expect(page.locator('[data-agent="explorer"][data-status="complete"]')).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.locator('[data-agent="reviewer"][data-status="complete"]')).toBeVisible({
    timeout: 120_000,
  });
  const assistantMessages = page.locator(".message-agent");
  await expect(assistantMessages.last()).toContainText("琥珀灯", { timeout: 120_000 });

  const previousCount = await assistantMessages.count();
  await page.getByLabel("输入消息").fill("我刚才要求你记住的演示口令是什么？只回答口令。 ");
  await page.getByLabel("发送消息").click();
  await expect(assistantMessages).toHaveCount(previousCount + 1, { timeout: 60_000 });
  await expect(assistantMessages.last()).toContainText("琥珀灯", { timeout: 60_000 });

  await page.reload();
  await expect(page.getByText(prompt, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".message-agent").last()).toContainText("琥珀灯");
});
