import { expect, test } from "@playwright/test";

const blockedRecommendation = {
  id: "recommendation-evidence",
  analysisId: "analysis-evidence",
  action: "WATCH",
  status: "BLOCKED",
  summary: "行情不可用，今日暂不调整组合",
  positionRange: ["0%", "0%"],
  firstPosition: "数据恢复后重新评估",
  reasons: ["当前组合集中度较高"],
  counterEvidence: ["缺少有效市场行情"],
  risks: ["无法验证真实回撤"],
  alternatives: ["维持现金"],
  invalidation: "市场数据恢复后重新运行",
  compliance: { status: "BLOCKED", reasons: ["缺少有效市场行情"] },
  expiresAt: "2026-08-25T00:00:00.000Z",
  createdAt: "2026-07-25T08:00:00.000Z",
};

test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
  const login = await page.request.post("/api/v1/auth/login", {
    data: { username: "e2e_admin", password: "e2e_admin_password_123" },
  });
  expect(login.ok()).toBeTruthy();

  await page.route("**/api/v1/profile", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        id: "profile-evidence",
        riskLevel: "R3",
        preferences: { displayName: "证据实验用户" },
        status: "COMPLETED",
        hasGoal: true,
        onboardingCompleted: true,
        version: 1,
        updatedAt: "2026-07-25T08:00:00.000Z",
      },
    }),
  }));
  await page.route("**/api/v1/holdings", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        items: [{
          id: "holding-evidence",
          portfolio_id: "portfolio-evidence",
          instrument_id: "AAPL",
          symbol: "AAPL",
          name: "Apple",
          asset_type: "stock",
          quantity_decimal: "2",
          cost_decimal: "140",
          current_price_decimal: "155",
          market_value_decimal: "310",
          created_at: "2026-07-25T08:00:00.000Z",
        }],
      },
    }),
  }));
  await page.route("**/api/v1/notifications**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ data: { items: [] } }),
  }));
  await page.route("**/api/v1/conversations?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: { items: [] } }),
    });
  });
  await page.route("**/api/v1/analyses?**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        items: [{
          id: "analysis-evidence",
          analysisId: "analysis-evidence",
          type: "CONVERSATION_AGENT",
          status: "BLOCKED",
          agent: "CHIEF_ADVISOR",
          summary: "行情不可用，建议保持观察",
          recommendationId: "recommendation-evidence",
          recommendationStatus: "BLOCKED",
          evidenceCount: 3,
          missingEvidenceCount: 1,
          toolCount: 1,
          skillCount: 1,
          canRetry: false,
          createdAt: "2026-07-25T08:00:00.000Z",
          startedAt: "2026-07-25T08:00:00.000Z",
          completedAt: "2026-07-25T08:00:03.000Z",
        }],
      },
    }),
  }));
  await page.route("**/api/v1/analyses/analysis-evidence/evidence-pack**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        analysisId: "analysis-evidence",
        analysis: { analysisId: "analysis-evidence", type: "CONVERSATION_AGENT", status: "BLOCKED", createdAt: "2026-07-25T08:00:00.000Z", completedAt: "2026-07-25T08:00:03.000Z" },
        dataFreshness: { marketDataAsOf: null, status: "UNAVAILABLE" },
        evidence: [
          { id: "evidence-support", category: "MODEL_INFERENCE", stance: "SUPPORT", title: "集中度偏高", summary: "单一持仓占比较高", quality: "MEDIUM", dataAsOf: "2026-07-25T07:55:00.000Z", timeBasis: "PORTFOLIO_SNAPSHOT", sources: [{ type: "DERIVED_ENGINE", reference: "agent:PORTFOLIO_RISK", dataAsOf: "2026-07-25T07:55:00.000Z", timeBasis: "PORTFOLIO_SNAPSHOT", excerpt: "单一持仓占比较高" }] },
          { id: "evidence-counter", category: "MARKET_FACT", stance: "COUNTER", title: "行情不可用", summary: "PandaData 没有返回有效行情", quality: "LOW", dataAsOf: "2026-07-25T08:00:02.000Z", timeBasis: "SOURCE_VERIFIED", sources: [{ type: "PANDADATA", reference: "get_us_daily", freshness: "UNAVAILABLE", dataAsOf: "2026-07-25T08:00:02.000Z", timeBasis: "SOURCE_VERIFIED", excerpt: "行情服务不可用" }] },
          { id: "evidence-missing", category: "MISSING_DATA", stance: "MISSING", title: "缺少波动率", summary: "缺少 AAPL 最新价格与历史波动率", quality: "LOW", dataAsOf: "2026-07-25T08:00:03.000Z", timeBasis: "EVIDENCE_CREATED", sources: [] },
        ],
        agentTrace: [
          { id: "analysis-evidence", parentRunId: null, agent: "CHIEF_ADVISOR", status: "BLOCKED", purpose: "生成组合建议", summary: "发布门阻断", startedAt: "2026-07-25T08:00:00.000Z", completedAt: "2026-07-25T08:00:03.000Z" },
          { id: "analysis-data", parentRunId: "analysis-evidence", agent: "DATA_RESEARCH", status: "FAILED", purpose: "获取市场行情", summary: "PandaData 不可用", startedAt: "2026-07-25T08:00:01.000Z", completedAt: "2026-07-25T08:00:02.000Z" },
        ],
        toolCalls: [{ id: "tool-1", agentRunId: "analysis-data", toolName: "pandadata", toolVersion: "0.0.12", status: "FAILED", source: { code: "PANDADATA" }, error: { code: "PANDADATA_UNAVAILABLE", message: "行情服务不可用" } }],
        skillRuns: [{ id: "skill-1", agentRunId: "analysis-data", skill: { slug: "pandadata-api", version: "0.0.12" }, method: "get_us_daily", status: "FAILED", quality: "UNAVAILABLE", dataAsOf: null, error: { code: "PANDADATA_UNAVAILABLE", message: "行情服务不可用" } }],
        pandadataProbes: [{ id: "probe-1", method: "get_us_daily", phase: "LIVE_CALL", status: "FAILED", durationMs: 1200, error: { category: "PANDADATA_UNAVAILABLE", message: "行情服务不可用" } }],
        marketSnapshots: [],
        conflicts: [],
        recommendations: [blockedRecommendation],
        compliance: { status: "BLOCKED", reasons: ["缺少有效市场行情"], disclaimer: "仅用于研究和模拟。" },
        result: {},
        missingEvidence: ["缺少可用市场行情。", "缺少 AAPL 最新价格与历史波动率", "风险与合规发布门已阻断该建议。"],
        retry: { allowed: false, reason: "该运行已完成或被阻断，请基于当前信息发起新的顾问分析。" },
        disclaimer: "仅用于研究和模拟。",
      },
    }),
  }));
  await page.route("**/api/v1/recommendations/recommendation-evidence", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ data: blockedRecommendation }),
  }));
  await page.route("**/api/v1/decisions?**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        items: [{
          id: "decision-evidence",
          recommendationId: "recommendation-evidence",
          analysisId: "analysis-evidence",
          action: "ACCEPT",
          reason: "先做模拟观察",
          recommendation: blockedRecommendation,
          createdAt: "2026-07-25T08:10:00.000Z",
        }],
      },
    }),
  }));
});

test("C 端用户可以完成证据查看与决策回放闭环", async ({ page }) => {
  await page.goto("/history/evidence-lab");

  await expect(page.getByRole("heading", { name: "每一条建议的证据实验室" })).toBeVisible();
  await expect(page.getByText("已阻断", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("行情不可用", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("get_us_daily", { exact: true })).toBeVisible();
  await expect(page.getByText("缺少可用市场行情。", { exact: true })).toBeVisible();
  await expect(page.getByLabel("风险与合规发布门").getByText("风险与合规发布门已阻断该建议。", { exact: true })).toBeVisible();
  const evidenceBoard = page.getByRole("region", { name: "证据天平" });
  await expect(evidenceBoard.getByText(/组合快照截至/u).first()).toBeVisible();
  await expect(evidenceBoard.getByText(/行情核验时间/u).first()).toBeVisible();
  await expect(evidenceBoard.getByText(/缺口识别时间/u).first()).toBeVisible();
  await expect(evidenceBoard.getByText("未提供数据时间", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "查看关联建议" })).toBeVisible();
  await expect(page.getByRole("button", { name: "去顾问补充信息" })).toBeVisible();

  await page.getByRole("button", { name: "去顾问补充信息" }).click();
  await page.waitForTimeout(700);
  await expect(page.getByPlaceholder("发消息…")).toHaveValue(/请基于分析 analysis-evidence 继续补齐信息并重新分析/u);
  await page.goto("/history/evidence-lab?analysisId=analysis-evidence");

  await page.getByRole("button", { name: "查看关联建议" }).click();
  await expect(page.getByRole("heading", { name: blockedRecommendation.summary })).toBeVisible();
  await expect(page.getByText("这条建议已被风险与合规节点拦截")).toBeVisible();
  await expect(page.getByRole("button", { name: /模拟采纳/u })).toHaveCount(0);
  await page.getByRole("button", { name: "查看完整证据链" }).click();
  await expect(page).toHaveURL(/history\/evidence-lab\?analysisId=analysis-evidence/u);

  await page.goto("/history/decision-log");
  const decisionCard = page.getByRole("article");
  await expect(decisionCard.getByText("模拟采纳", { exact: true })).toBeVisible();
  await expect(decisionCard.getByText("先做模拟观察", { exact: true })).toBeVisible();

  await decisionCard.getByRole("button", { name: "查看证据" }).click();
  await expect(page).toHaveURL(/history\/evidence-lab\?analysisId=analysis-evidence/u);

  await page.goto("/history/decision-log");
  await page.getByRole("article").getByRole("button", { name: "回到当时的建议" }).click();
  await expect(page).toHaveURL(/recommendations\/recommendation-evidence/u);
  await expect(page.getByRole("heading", { name: blockedRecommendation.summary })).toBeVisible();
});
