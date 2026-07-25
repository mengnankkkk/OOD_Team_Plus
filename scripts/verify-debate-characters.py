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
        expect(page.get_by_text("正在准备圆桌会议")).to_be_visible()
        expect(page.locator(".debate-stage")).to_be_visible(timeout=5_000)

        expect(page.locator(".debate-character")).to_have_count(4)
        for image in page.locator(".debate-character-image").all():
            width = image.evaluate("element => element.naturalWidth")
            assert width > 0
            report["image_widths"].append(width)
        report["checks"].append("four Unity character images loaded")

        page.screenshot(path=ARTIFACT_DIR / "desktop-initial.png", full_page=True)
        assert_characters_inside_stage(page)

        page.get_by_label(re.compile(r"^看多 agent")).click()
        expect(page.get_by_role("status")).to_be_visible()
        expect(page.locator(".debate-character-pushed")).to_have_count(1)
        report["checks"].append("manual shove interaction")

        prompt = "新能源板块现在适合分批投入吗？"
        composer = page.get_by_placeholder("输入要讨论的问题...")
        composer.fill(prompt)
        composer.press("Enter")
        expect(page.get_by_text(prompt, exact=True)).to_be_visible()
        expect(page.locator(".debate-character-user.debate-character-active")).to_be_visible()
        report["checks"].append("Hisa mirrors the user message")

        expect(page.get_by_text(re.compile(r"^看多观点："))).to_be_visible(timeout=3_000)
        expect(page.get_by_text(re.compile(r"^看空观点："))).to_be_visible(timeout=3_000)
        page.wait_for_selector(".debate-character-shoving", timeout=2_000)
        page.screenshot(path=ARTIFACT_DIR / "desktop-clash.png", full_page=True)
        report["checks"].append("Student and Shark speak and clash")

        expect(page.get_by_text(re.compile(r"^评委结论："))).to_be_visible(timeout=4_000)
        expect(page.locator(".debate-character-moderator.debate-character-active")).to_be_visible()
        page.screenshot(path=ARTIFACT_DIR / "desktop-judge.png", full_page=True)
        assert_characters_inside_stage(page)
        report["checks"].append("Teacher publishes the judge bubble")

        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(500)
        expect(page.locator(".debate-character")).to_have_count(4)
        assert_characters_inside_stage(page)
        page.screenshot(path=ARTIFACT_DIR / "mobile-judge.png", full_page=True)
        report["checks"].append("mobile characters stay inside the stage")

        report["body_scroll_width"] = page.evaluate("document.body.scrollWidth")
        report["viewport_width"] = page.evaluate("window.innerWidth")
        browser.close()

    report_path = ARTIFACT_DIR / "verification.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
