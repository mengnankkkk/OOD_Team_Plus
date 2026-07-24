import { describe, expect, it } from "vitest";

import { activeRuns } from "@/server/advisor/active-runs";
import { AdvisorService } from "@/server/advisor/service";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import { AdvisorStore } from "@/server/advisor/store";

describe("advisor service lifecycle", () => {
  it("resumes a completed analysis after the blocking clarification is answered", async () => {
    const store = new AdvisorStore();
    const service = new AdvisorService(store);
    const conversationId = "conversation_service_resume";
    const started = await service.sendMessage(conversationId, {
      content: "科技板块跌得很严重，现在是不是入场时机？",
      clientMessageId: "service-resume-message",
    });

    await activeRuns.get(conversationId)?.promise;
    expect(service.getAnalysis(started.analysisId).status).toBe("WAITING_FOR_USER");
    const clarification = store.conversations.listClarifications(DEMO_USER_ID, conversationId, "OPEN")[0];
    expect(clarification?.analysisId).toBe(started.analysisId);

    service.answerClarification(conversationId, clarification.id, {
      answers: { holdingPeriod: "MEDIUM", investmentAmount: 30_000, maxDrawdown: 0.15 },
    });
    await activeRuns.get(conversationId)?.promise;

    const analysis = service.getAnalysis(started.analysisId);
    expect(analysis.status).toBe("COMPLETED");
    expect(analysis.result?.status).toBe("DEGRADED");
    expect(store.listEvidence(started.analysisId).length).toBeGreaterThan(0);
  });

  it("keeps goal preferences and watchlist entries in SQLite", () => {
    const store = new AdvisorStore();
    const goal = store.profile.createGoal(DEMO_USER_ID, {
      name: "服务测试目标",
      targetAmount: "100000",
      initialInvestmentAmount: "10000",
      monthlyContributionAmount: "1000",
      horizon: "MEDIUM",
      instrumentPreferences: ["BROAD_INDEX_ETF", "GOLD"],
    });
    expect(goal.instrumentPreferences).toEqual(["BROAD_INDEX_ETF", "GOLD"]);

    const item = store.watchlist.add(DEMO_USER_ID, "instrument_000001_sz", "观察估值");
    expect(store.watchlist.list(DEMO_USER_ID)[0]?.instrument.id).toBe("instrument_000001_sz");
    expect(store.watchlist.remove(DEMO_USER_ID, item.id)).toBe(true);
  });

  it("reuses answered consultation context for the next question in the same conversation", async () => {
    const store = new AdvisorStore();
    const service = new AdvisorService(store);
    const conversationId = "conversation_context_reuse";
    const first = await service.sendMessage(conversationId, {
      content: "科技板块最近跌了，现在是不是入场时机？",
      clientMessageId: "context-reuse-first",
    });

    await activeRuns.get(conversationId)?.promise;
    const clarification = store.conversations.listClarifications(DEMO_USER_ID, conversationId, "OPEN")[0];
    expect(clarification?.analysisId).toBe(first.analysisId);

    service.answerClarification(conversationId, clarification!.id, {
      answers: {
        holdingPeriod: "MEDIUM",
        investmentAmount: 30_000,
        maxDrawdown: 0.15,
        nearTermUse: false,
      },
    });
    await activeRuns.get(conversationId)?.promise;

    const second = await service.sendMessage(conversationId, {
      content: "我还有黄金半仓，现在涨了，是追高加仓还是先减仓？",
      clientMessageId: "context-reuse-second",
    });
    await activeRuns.get(conversationId)?.promise;

    expect(service.getAnalysis(second.analysisId).status).toBe("COMPLETED");
    expect(store.conversations.listClarifications(DEMO_USER_ID, conversationId, "OPEN")).toHaveLength(0);
  });
});
