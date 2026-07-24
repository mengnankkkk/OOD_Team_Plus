from pathlib import Path
from uuid import uuid4

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "artifacts" / "visual-migration"
OUTPUT.mkdir(parents=True, exist_ok=True)

BASELINE = "http://127.0.0.1:4173"
NEXT_APP = "http://127.0.0.1:3020"
PAGES = [
    ("login", "/login"),
    ("home", "/"),
    ("assets", "/assets"),
    ("advisor", "/advisor"),
]
VIEWPORTS = {
    "desktop": {"width": 1440, "height": 900},
    "mobile": {"width": 393, "height": 851},
}


def settle(page) -> None:
    page.wait_for_load_state("networkidle")
    page.emulate_media(reduced_motion="reduce")
    page.wait_for_timeout(250)


def authenticate_next(page) -> None:
    page.goto(f"{NEXT_APP}/login")
    settle(page)
    if "/login" not in page.url:
        return
    page.get_by_role("button", name="还没有账号？创建一个").click()
    suffix = uuid4().hex[:10]
    page.get_by_label("称呼").fill("视觉回归用户")
    page.get_by_label("用户名").fill(f"visual_{suffix}")
    page.get_by_label("密码").fill("visual-regression-password-123")
    page.get_by_role("button", name="创建账号并登录").click()
    page.wait_for_url(f"{NEXT_APP}/")


def capture(base_url: str, label: str, browser, viewport_name: str, viewport: dict) -> None:
    context = browser.new_context(viewport=viewport, device_scale_factor=1)
    page = context.new_page()
    if label == "next":
        authenticate_next(page)
    for name, route in PAGES:
        page.goto(f"{base_url}{route}")
        settle(page)
        page.screenshot(path=str(OUTPUT / f"{label}-{viewport_name}-{name}.png"), full_page=True)
    context.close()


with sync_playwright() as playwright:
    chromium = playwright.chromium.launch(headless=True)
    for viewport_name, viewport in VIEWPORTS.items():
        capture(BASELINE, "baseline", chromium, viewport_name, viewport)
        capture(NEXT_APP, "next", chromium, viewport_name, viewport)
    chromium.close()

print(f"visual screenshots written to {OUTPUT}")
