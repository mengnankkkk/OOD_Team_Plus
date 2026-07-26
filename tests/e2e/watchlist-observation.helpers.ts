import { expect, type Page } from "@playwright/test";

type AlertFixture = {
  id: string;
  sourceType: string;
  sourceId: string;
  severity: string;
  title: string;
  bodyText: string;
  status: "unread" | "read" | "dismissed";
  dataAsOf: string;
  occurrenceCount: number;
  version: number;
  metadata: {
    symbol: string;
    name: string;
    advisorPrompt: string;
  };
  created_at: string;
};

export async function prepareWatchlistUser(page: Page, mobile: boolean) {
  const username = `wl_${mobile ? "m" : "d"}_${Date.now().toString(36)}`;
  const registration = await page.request.post("/api/v1/auth/register", {
    headers: { "x-forwarded-for": username },
    data: {
      username,
      password: "watchlist_e2e_password_123",
      displayName: "持仓观测测试用户",
    },
  });
  const registrationBody = await registration.json();
  expect(registration.ok(), JSON.stringify(registrationBody)).toBeTruthy();
  const csrfToken = registrationBody.data.csrfToken as string;

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
        name: "长期财富目标",
        targetAmount: "1000000",
        targetDate: "2035-12-31",
        priority: "1",
        assetPreference: "STOCK",
      },
      portfolio: {
        id: "portfolio-watchlist-e2e",
        holdings: [{
          instrumentId: "AAPL",
          quantity: "2",
          cost: "140",
        }],
      },
    },
  });
  expect(onboarding.ok()).toBeTruthy();

  const instrument = await page.request.post("/api/v1/instruments/resolve", {
    headers: { "X-CSRF-Token": csrfToken },
    data: {
      symbol: "600519",
      name: "贵州茅台",
      market: "SH",
      assetType: "stock",
      sector: "食品饮料",
    },
  });
  expect(instrument.ok()).toBeTruthy();
}

export async function mockWatchlistAlerts(page: Page) {
  const alertRows = [
    alertRow("alert-move", "WATCHLIST_MOVE", "贵州茅台出现单日异动"),
    alertRow("alert-drawdown", "WATCHLIST_DRAWDOWN", "贵州茅台触及回撤线"),
    alertRow("alert-event", "WATCHLIST_EVENT", "贵州茅台新闻事件"),
    alertRow("alert-condition", "WATCH_CONDITION", "贵州茅台价格条件触发"),
  ];

  await page.route(/\/api\/v1\/notifications(?:\/[^?]*)?(?:\?.*)?$/u, async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/v1/notifications/sync") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: request.method() === "GET"
            ? syncState()
            : {
              status: "succeeded",
              createdCount: 0,
              marketRefreshSucceeded: true,
              dataAsOf: "2026-07-25T08:00:00.000Z",
              errorCode: null,
              errorMessage: null,
            },
        }),
      });
      return;
    }
    if (pathname === "/api/v1/notifications") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            items: alertRows.filter((item) => item.status !== "dismissed"),
            unreadCount: alertRows.filter((item) => item.status === "unread").length,
          },
        }),
      });
      return;
    }
    const id = pathname.split("/").at(-1);
    const row = alertRows.find((item) => item.id === id);
    if (!row) {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return;
    }
    if (request.method() === "PATCH") {
      const action = request.postDataJSON() as { action: "MARK_READ" | "IGNORE" };
      row.status = action.action === "MARK_READ" ? "read" : "dismissed";
      row.version += 1;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: row }),
    });
  });
}

export async function assertMobileOverlayWidth(page: Page, overlay: ReturnType<Page["locator"]>) {
  const [box, viewport] = await Promise.all([
    overlay.boundingBox(),
    page.evaluate(() => document.documentElement.clientWidth),
  ]);
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x).toBeLessThanOrEqual(18);
  expect(box!.width).toBeGreaterThanOrEqual(viewport - 36);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport);
}

function alertRow(id: string, sourceType: string, title: string): AlertFixture {
  return {
    id,
    sourceType,
    sourceId: "watchitem-alert",
    severity: "ATTENTION",
    title,
    bodyText: "请结合目标和观察规则复核影响。",
    status: "unread",
    dataAsOf: "2026-07-25T08:00:00.000Z",
    occurrenceCount: 1,
    version: 1,
    metadata: {
      symbol: "600519",
      name: "贵州茅台",
      advisorPrompt: `请分析${title}`,
    },
    created_at: "2026-07-25T08:05:00.000Z",
  };
}

function syncState() {
  return {
    status: "succeeded",
    lastAttemptAt: "2026-07-25T08:05:00.000Z",
    lastSuccessAt: "2026-07-25T08:05:00.000Z",
    lastMarketRefreshAt: "2026-07-25T08:05:00.000Z",
    dataAsOf: "2026-07-25T08:00:00.000Z",
    errorCode: null,
    errorMessage: null,
  };
}
