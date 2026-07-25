import json
from pathlib import Path
from uuid import uuid4

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / ".artifacts"
ORIGIN = "http://127.0.0.1:3012"


def run() -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    console_errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)

        page.goto(f"{ORIGIN}/login")
        page.wait_for_load_state("networkidle")
        page.locator("form button[type=button]").click()
        page.locator("#displayName").fill("Injective UI Tester")
        page.locator("#username").fill(f"injective_ui_{uuid4().hex[:8]}")
        page.locator("#password").fill("injective_ui_password_2026")
        page.locator("form button[type=submit]").click()
        page.wait_for_url(f"{ORIGIN}/", timeout=20_000)

        csrf = next(cookie["value"] for cookie in context.cookies() if cookie["name"] == "mw_csrf")
        mutation_headers = {
            "Origin": ORIGIN,
            "X-CSRF-Token": csrf,
            "Idempotency-Key": str(uuid4()),
        }
        questionnaire = page.request.get(f"{ORIGIN}/api/v1/risk-questionnaire")
        assert questionnaire.ok, questionnaire.text()
        questions = questionnaire.json()["data"]["questions"]
        answers = {question["id"]: question["options"][0]["value"] for question in questions}
        instrument_response = page.request.post(
            f"{ORIGIN}/api/v1/instruments/resolve",
            headers=mutation_headers,
            data={"symbol": "AAPL", "name": "Apple", "assetType": "stock", "market": "NASDAQ"},
        )
        assert instrument_response.ok, instrument_response.text()
        instrument_id = instrument_response.json()["data"]["instrumentId"]
        mutation_headers["Idempotency-Key"] = str(uuid4())
        onboarding_response = page.request.post(
            f"{ORIGIN}/api/v1/onboarding/complete",
            headers=mutation_headers,
            data={
                "answers": answers,
                "profile": {
                    "displayName": "Injective UI Tester",
                    "age": 30,
                    "household": "UI test account",
                    "monthlyIncome": "30000",
                    "monthlyExpense": "12000",
                    "liabilities": "0",
                    "emergencyTargetMonths": 6,
                    "investmentAmount": "50000",
                    "horizon": "LONG",
                    "maxDrawdown": "0.20",
                },
                "goal": {
                    "name": "Verify Injective proof",
                    "targetAmount": "300000",
                    "targetDate": "2030-12-31",
                    "priority": "1",
                    "assetPreference": "INDEX",
                },
                "portfolio": {
                    "id": "portfolio-injective-ui",
                    "holdings": [{"instrumentId": instrument_id, "quantity": "2", "cost": "140"}],
                },
            },
        )
        assert onboarding_response.ok, onboarding_response.text()
        console_errors.clear()  # Ignore the expected unauthenticated /auth/me probe on the login screen.

        page.goto(f"{ORIGIN}/injective")
        page.wait_for_load_state("networkidle")
        page.locator("h1").wait_for()
        page.locator("button:has(svg.lucide-rotate-ccw)").click()
        page.locator("text=SHA-256 Fingerprint").wait_for()
        page.wait_for_function("document.body.innerText.includes('0x')")
        page.screenshot(path=str(ARTIFACTS / "injective-desktop.png"), full_page=True)

        page.locator("button:has(svg.lucide-wallet)").click()
        page.locator("[role=alert]").filter(has_text="EVM").wait_for()

        context.add_init_script("""
          window.ethereum = {
            request: async ({ method }) => {
              if (method === 'eth_requestAccounts' || method === 'eth_accounts') return ['0x1111111111111111111111111111111111111111'];
              if (method === 'eth_chainId') return '0x59f';
              if (method === 'eth_getBalance') return '0xde0b6b3a7640000';
              if (method === 'eth_sendTransaction') return '0x' + 'ab'.repeat(32);
              if (method === 'eth_getTransactionReceipt') return { status: '0x1', blockNumber: '0x2a' };
              if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
              throw new Error('Unexpected wallet method: ' + method);
            }
          };
        """)
        page.reload()
        page.wait_for_load_state("networkidle")
        page.locator("button:has(svg.lucide-rotate-ccw)").click()
        page.wait_for_function("document.body.innerText.includes('0x')")
        page.locator("button:has(svg.lucide-wallet)").click()
        explorer_link = page.locator("a[href^='https://testnet.blockscout.injective.network/tx/']")
        explorer_link.wait_for()
        assert explorer_link.get_attribute("href") == "https://testnet.blockscout.injective.network/tx/0x" + "ab" * 32
        wallet_success_state = explorer_link.is_visible()

        page.set_viewport_size({"width": 390, "height": 844})
        page.goto(f"{ORIGIN}/injective")
        page.wait_for_load_state("networkidle")
        page.locator("h1").wait_for()
        no_horizontal_overflow = page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")
        page.screenshot(path=str(ARTIFACTS / "injective-mobile.png"), full_page=True)
        assert no_horizontal_overflow, "Injective page has horizontal overflow on mobile"

        result = {
            "heading": page.locator("h1").is_visible(),
            "hash_generated": page.locator("text=SHA-256 Fingerprint").is_visible(),
            "wallet_success_state": wallet_success_state,
            "mobile_has_no_horizontal_overflow": no_horizontal_overflow,
            "console_errors": console_errors,
            "screenshots": [".artifacts/injective-desktop.png", ".artifacts/injective-mobile.png"],
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        browser.close()


if __name__ == "__main__":
    run()
