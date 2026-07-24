import { AdvisorError } from "@/server/advisor/http";
import { MarketDataService } from "@/server/advisor/market-service";
import { DEMO_USER_ID } from "@/server/advisor/seed";
import type { AdvisorStore } from "@/server/advisor/store";

export class WatchService {
  constructor(private readonly store: AdvisorStore) {}

  list(status?: string) {
    return this.store.decisions.listWatchConditions(DEMO_USER_ID, status);
  }

  create(input: Record<string, unknown>) {
    if (!input.instrumentId && !input.recommendationId && input.type !== "REVIEW_DATE") {
      throw new AdvisorError("VALIDATION_ERROR", "观察条件至少需要关联标的或建议。", 422);
    }
    return this.store.decisions.createWatchCondition(DEMO_USER_ID, input);
  }

  update(conditionId: string, patch: Record<string, unknown>, expectedVersion?: number) {
    try {
      const result = this.store.decisions.updateWatchCondition(DEMO_USER_ID, conditionId, patch, expectedVersion);
      if (!result) throw new AdvisorError("RESOURCE_NOT_FOUND", "观察条件不存在。", 404);
      return result;
    } catch (error) {
      if (error instanceof Error && error.message === "VERSION_CONFLICT") {
        throw new AdvisorError("VERSION_CONFLICT", "观察条件版本已变化，请刷新后重试。", 412);
      }
      throw error;
    }
  }

  remove(conditionId: string) {
    if (!this.store.decisions.deleteWatchCondition(DEMO_USER_ID, conditionId)) {
      throw new AdvisorError("RESOURCE_NOT_FOUND", "观察条件不存在。", 404);
    }
  }

  async evaluate(conditionIds?: string[]) {
    const conditions = this.list("ACTIVE").filter((condition) => !conditionIds || conditionIds.includes(condition.id));
    const portfolio = await import("@/server/advisor/portfolio-service").then(({ PortfolioService }) =>
      new PortfolioService(this.store).buildSnapshot(DEMO_USER_ID, "diagnosis"),
    );
    const market = new MarketDataService(this.store);
    const results = [];
    for (const condition of conditions) {
      const result = await evaluateCondition(this.store, market, portfolio.diagnostic, condition);
      const event = this.store.decisions.recordWatchEvent(condition.id, result.triggered ? "TRIGGERED" : "OBSERVED", result.observedValue, result.summary);
      results.push({ condition, ...result, event });
    }
    return { evaluatedAt: new Date().toISOString(), items: results };
  }
}

async function evaluateCondition(
  store: AdvisorStore,
  market: MarketDataService,
  diagnostic: Record<string, unknown>,
  condition: { id: string; type: string; instrumentId: string | null; parameters: Record<string, unknown> },
) {
  const parameters = condition.parameters;
  if (condition.type === "REVIEW_DATE") {
    const dueAt = String(parameters.date ?? parameters.reviewDate ?? "");
    const triggered = Boolean(dueAt) && new Date(dueAt).getTime() <= Date.now();
    return { triggered, observedValue: new Date().toISOString(), summary: triggered ? "已到复核日期。" : `下次复核日期为 ${dueAt || "未设置"}。` };
  }
  if (!condition.instrumentId) return { triggered: false, observedValue: null, summary: "缺少关联标的，无法评估。" };
  const instrument = store.profile.getInstrument(condition.instrumentId);
  if (!instrument) return { triggered: false, observedValue: null, summary: "关联标的不存在。" };
  const snapshot = await market.getSnapshot(instrument);
  const technical = (snapshot.metrics.technical ?? {}) as Record<string, unknown>;
  const valuation = (snapshot.metrics.valuation ?? {}) as Record<string, unknown>;
  const triggered = condition.type === "PRICE_ENTER_ZONE"
    ? inRange(Number(technical.lastPrice), Number(parameters.low ?? parameters.priceLow), Number(parameters.high ?? parameters.priceHigh))
    : condition.type === "DRAWDOWN_REACH"
      ? Number(technical.currentDrawdown ?? 0) <= Number(parameters.threshold ?? -0.1)
      : condition.type === "PE_PERCENTILE_BELOW"
        ? Number(valuation.peThreeYearPercentile ?? 1) <= Number(parameters.percentile ?? 0.3)
        : condition.type === "MACD_CONFIRMATION"
          ? String(technical.macdState) === String(parameters.state ?? "DAILY_GOLDEN_CROSS")
          : condition.type === "POSITION_WEIGHT_ABOVE"
            ? positionWeight(diagnostic, condition.instrumentId) >= Number(parameters.threshold ?? 0.1)
            : condition.type === "EVENT_RISK"
              ? Array.isArray(snapshot.metrics.events) && snapshot.metrics.events.length > 0
              : false;
  return {
    triggered,
    observedValue: { price: technical.lastPrice, drawdown: technical.currentDrawdown, pePercentile: valuation.peThreeYearPercentile, macdState: technical.macdState },
    summary: triggered ? `${instrument.name} 已满足 ${condition.type} 观察条件。` : `${instrument.name} 当前未满足 ${condition.type} 观察条件。`,
  };
}

function inRange(value: number, low: number, high: number) {
  return Number.isFinite(value) && Number.isFinite(low) && Number.isFinite(high) && value >= low && value <= high;
}

function positionWeight(diagnostic: Record<string, unknown>, instrumentId: string) {
  const holdings = Array.isArray(diagnostic.holdings) ? diagnostic.holdings : [];
  const holding = holdings.find((item) => {
    const value = item as Record<string, unknown>;
    return value.holdingId === instrumentId || (value.asset as Record<string, unknown> | undefined)?.instrumentId === instrumentId;
  }) as Record<string, unknown> | undefined;
  const position = holding?.position as Record<string, unknown> | undefined;
  return Number(position?.portfolioWeight ?? 0);
}
