from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = "http://127.0.0.1:3000"
OUTPUT_DIR = Path("artifacts/alerts")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def api_post(page, path: str, body: dict):
    return page.evaluate(
        """async ({ path, body }) => {
          const csrf = document.cookie.split(';').map(v => v.trim()).find(v => v.startsWith('mw_csrf='))?.split('=')[1];
          const response = await fetch(path, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': crypto.randomUUID(),
              'X-CSRF-Token': decodeURIComponent(csrf || ''),
            },
            body: JSON.stringify(body),
          });
          return { status: response.status, payload: await response.json() };
        }""",
        {"path": path, "body": body},
    )


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    username = f"alert_ui_{datetime.now().strftime('%H%M%S')}"
    password = "AlertUiPass_2026"

    page.goto(f"{BASE_URL}/login")
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="还没有账号？创建一个").click()
    page.get_by_label("称呼").fill("提醒验收用户")
    page.get_by_label("用户名").fill(username)
    page.get_by_label("密码").fill(password)
    page.get_by_role("button", name="创建账号并登录").click()
    page.wait_for_url(f"{BASE_URL}/", timeout=30000)
    page.wait_for_load_state("networkidle")

    questions = page.evaluate("async () => (await (await fetch('/api/v1/risk-questionnaire')).json()).data.questions")
    answers = {question["id"]: question["options"][0]["value"] for question in questions}
    onboarding = api_post(page, "/api/v1/onboarding/complete", {
        "answers": answers,
        "profile": {
            "displayName": "提醒验收用户",
            "monthlyIncome": "20000",
            "monthlyExpense": "8000",
            "liabilities": "0",
            "emergencyTargetMonths": 6,
            "investmentAmount": "50000",
            "horizon": "LONG",
            "maxDrawdown": "0.20",
        },
        "goal": {
            "name": "长期资产增长",
            "targetAmount": "300000",
            "targetDate": "2029-12-31",
            "priority": "1",
            "assetPreference": "INDEX",
        },
    })
    assert onboarding["status"] == 201, onboarding

    instrument = api_post(page, "/api/v1/instruments/resolve", {"symbol": "AAPL", "name": "Apple", "assetType": "stock"})
    assert instrument["status"] in (200, 201), instrument
    instrument_id = instrument["payload"]["data"]["instrumentId"]
    holding = api_post(page, "/api/v1/holdings", {"instrumentId": instrument_id, "quantity": "10", "cost": "200", "portfolioId": "alerts-ui"})
    assert holding["status"] == 201, holding
    sync = api_post(page, "/api/v1/notifications/sync", {"forceMarketRefresh": False})
    assert sync["status"] == 200, sync

    page.goto(f"{BASE_URL}/alerts")
    page.wait_for_load_state("networkidle")
    page.get_by_role("heading", name="提醒中心").wait_for()
    page.get_by_text("单一持仓占比过高", exact=False).wait_for()
    assert page.get_by_text("行情状态").is_visible()
    assert page.get_by_role("button", name="同步行情").is_visible()
    page.screenshot(path=str(OUTPUT_DIR / "desktop.png"), full_page=True)

    page.set_viewport_size({"width": 390, "height": 844})
    page.reload()
    page.wait_for_load_state("networkidle")
    page.get_by_text("单一持仓占比过高", exact=False).wait_for()
    page.screenshot(path=str(OUTPUT_DIR / "mobile.png"), full_page=True)

    target_alert = page.locator("article.alert-row").filter(has_text="单一持仓占比过高")
    target_alert.get_by_role("button", name="问顾问").click()
    page.wait_for_url(lambda url: "/advisor?" in url, timeout=30000)
    page.get_by_placeholder("发消息…").wait_for(timeout=30000)
    assert "AAPL" in page.get_by_placeholder("发消息…").input_value()
    browser.close()
