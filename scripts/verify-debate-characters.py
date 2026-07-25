import json
import os
import re
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


BASE_URL = os.environ.get("MONEY_WHISPERER_BASE_URL", "http://127.0.0.1:3000")
ARTIFACT_DIR = Path("artifacts/debate-characters")


def assert_characters_inside_stage(page):
    stage = page.locator(".debate-stage").bounding_box()
    assert stage is not None
    for character in page.locator(".debate-character").all():
        box = character.bounding_box()
        assert box is not None
        assert box["x"] >= stage["x"] - 1
        assert box["y"] >= stage["y"] - 1
        assert box["x"] + box["width"] <= stage["x"] + stage["width"] + 1
        assert box["y"] + box["height"] <= stage["y"] + stage["height"] + 1


def main():
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    report = {"console_errors": [], "image_widths": [], "checks": []}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 980}, device_scale_factor=1)
        page.on(
            "console",
            lambda message: report["console_errors"].append(message.text)
            if message.type == "error"
            else None,
        )

        page.goto(f"{BASE_URL}/login")
        page.wait_for_load_state("networkidle")
        page.get_by_role("button", name="还没有账号？创建一个").click()
        page.get_by_label("称呼").fill("圆桌验证用户")
        page.get_by_label("用户名").fill(f"debate_verify_{int(time.time())}")
        page.get_by_label("密码").fill("local_debate_verify_123")
        page.get_by_role("button", name="创建账号并登录").click()
        expect(page).to_have_url(re.compile(r"/$"), timeout=15_000)

        onboarding = page.get_by_role("dialog")
        expect(onboarding).to_be_visible()
        risk_answers = [
            "收入稳定，扣除日常支出后仍有明显结余",
            "12 个月以上",
            "没有负债，或还款压力很低",
            "几乎没有投资经验",
            "基本不了解，希望从简单的方案开始",
            "3-5 年内可能使用",
            "继续持有，等待市场恢复",
            "10%-20%",
            "没有，资金可以长期投资",
        ]
        for answer in risk_answers:
            onboarding.get_by_role("button", name=answer).click()
            onboarding.get_by_role("button", name=re.compile("下一题|进入下一步")).click()
        onboarding.get_by_label("月度收入（元）").fill("30000")
        onboarding.get_by_label("月度必要支出（元）").fill("12000")
        onboarding.get_by_label("负债余额（元）").fill("0")
        onboarding.get_by_label("本次计划投资金额（元）").fill("50000")
        onboarding.get_by_role("button", name="进入下一步").click()
        onboarding.get_by_label("目标金额（元）").fill("300000")
        onboarding.get_by_label("目标日期").fill("2030-12-31")
        onboarding.get_by_role("button", name="进入下一步").click()
        onboarding.get_by_label("标的名称").fill("Apple")
        onboarding.get_by_label("代码").fill("AAPL")
        onboarding.get_by_label("持有数量 / 份额").fill("2")
        onboarding.get_by_label("持仓成本价").fill("140")
        onboarding.get_by_role("button", name="完成建档并进入工作台").click()
        expect(onboarding).to_be_hidden(timeout=15_000)

        page.goto(f"{BASE_URL}/advisor")
        page.wait_for_load_state("networkidle")
        page.get_by_role("button", name="模式选择").click()
        page.get_by_text("辩论模式", exact=True).click()
        expect(page.get_by_text("正在进入辩论模式")).to_be_visible()
        expect(page.locator(".debate-stage")).to_be_visible(timeout=5_000)
        desktop_history = page.locator(".advisor-workbench-debate > .debate-history-rail").first
        expect(desktop_history).to_be_visible()
        assert page.evaluate(
            "() => document.documentElement.scrollHeight <= window.innerHeight + 1"
            " && document.body.scrollHeight <= window.innerHeight + 1",
        )

        expect(page.locator(".debate-character")).to_have_count(4)
        page.wait_for_function(
            "() => [...document.querySelectorAll('.debate-character-image')].every((image) => image.complete && image.naturalWidth > 0)",
        )
        for image in page.locator(".debate-character-image").all():
            expect(image).to_have_js_property("complete", True)
            width = image.evaluate("element => element.naturalWidth")
            assert width > 0
            report["image_widths"].append(width)
        report["checks"].append("four Unity character images loaded")

        page.screenshot(path=ARTIFACT_DIR / "desktop-initial.png", full_page=True)
        assert_characters_inside_stage(page)

        prompt = "新能源板块现在适合分批投入吗？"
        composer = page.get_by_placeholder("向多方、空方或裁判提问…")
        composer.fill(prompt)
        composer.press("Control+Enter")
        history_rail = page.locator(".debate-history-rail").first
        expect(history_rail.locator(".debate-history-entry-user p").first).to_have_text(prompt)
        expect(page.locator(".debate-stage").get_by_text(prompt, exact=True)).to_be_visible()
        report["checks"].append("Hisa mirrors the user message")

        expect(history_rail).to_contain_text("辩论记录")
        page.wait_for_function(
            """() => {
                const rail = document.querySelector('.debate-history-rail');
                const bull = rail?.querySelector('.debate-history-entry-bull p')?.textContent?.trim();
                const blocked = rail?.querySelector('.debate-history-entry-judge p')?.textContent?.includes('模型服务');
                return Boolean(bull || blocked);
            }""",
            timeout=120_000,
        )
        bull_entry = history_rail.locator(".debate-history-entry-bull p").first
        if bull_entry.count():
            expect(bull_entry).not_to_have_text("")
            expect(history_rail.locator(".debate-history-entry-bear p").first).not_to_have_text("")
            report["checks"].append("Battle history records the user and both sides")
        else:
            expect(history_rail.locator(".debate-history-entry-judge p").first).to_contain_text("模型服务")
            report["checks"].append("Battle history shows an explicit blocked-agent status")
        page.screenshot(path=ARTIFACT_DIR / "desktop-debate.png", full_page=True)
        assert page.evaluate(
            "() => document.documentElement.scrollHeight <= window.innerHeight + 1"
            " && document.body.scrollHeight <= window.innerHeight + 1",
        )

        if bull_entry.count():
            expect(history_rail.locator(".debate-history-entry-judge p").first).not_to_have_text("")
            expect(page.locator(".debate-bubble-judge")).to_be_visible(timeout=120_000)
        else:
            expect(page.locator(".debate-stage-status-blocked")).to_be_visible()
        page.screenshot(path=ARTIFACT_DIR / "desktop-judge.png", full_page=True)
        report["checks"].append("Battle stage exposes the final agent state")

        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(500)
        expect(page.locator(".debate-character")).to_have_count(4)
        assert_characters_inside_stage(page)
        page.screenshot(path=ARTIFACT_DIR / "mobile-judge.png", full_page=True)
        report["checks"].append("mobile characters stay inside the stage")

        report["body_scroll_width"] = page.evaluate("document.body.scrollWidth")
        report["body_scroll_height"] = page.evaluate("document.body.scrollHeight")
        report["viewport_width"] = page.evaluate("window.innerWidth")
        report["viewport_height"] = page.evaluate("window.innerHeight")
        assert report["body_scroll_height"] <= report["viewport_height"] + 1
        browser.close()

    report_path = ARTIFACT_DIR / "verification.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
