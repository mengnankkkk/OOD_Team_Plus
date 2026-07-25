import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/frontend-migration/api", () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
}));

import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
} from "@/features/frontend-migration/api";

import {
  createObservationCondition,
  deleteObservationCondition,
  evaluateObservationConditions,
  listObservationConditions,
  updateObservationCondition,
  type ObservationConditionCreateInput,
} from "./observationConditionService";

describe("observationConditionService", () => {
  beforeEach(() => {
    vi.mocked(apiDelete).mockReset();
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiPatch).mockReset();
    vi.mocked(apiPost).mockReset();
  });

  it("lists rules for one item and preserves uppercase public fields", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      items: [{
        id: "condition_1",
        watchlistItemId: "item_1",
        instrumentId: "600519.SH",
        conditionType: "PRICE_BELOW",
        threshold: "1200",
        thresholdDate: null,
        windowDays: null,
        severity: "IMPORTANT",
        status: "ACTIVE",
        lastObserved: null,
        lastEvaluatedAt: null,
        lastTriggeredAt: null,
        version: 1,
        createdAt: "2026-07-25T00:00:00.000Z",
        updatedAt: "2026-07-25T00:00:00.000Z",
      }],
    });

    const result = await listObservationConditions("item_1");

    expect(apiGet).toHaveBeenCalledWith(
      "/api/v1/observation-conditions?watchlistItemId=item_1&limit=100",
    );
    expect(result[0]).toMatchObject({
      conditionType: "PRICE_BELOW",
      severity: "IMPORTANT",
      status: "ACTIVE",
    });
  });

  it.each<ObservationConditionCreateInput>([
    {
      watchlistItemId: "item_1",
      conditionType: "PRICE_ABOVE",
      threshold: "1600",
      severity: "ATTENTION",
    },
    {
      watchlistItemId: "item_1",
      conditionType: "PRICE_BELOW",
      threshold: "1200",
      severity: "IMPORTANT",
    },
    {
      watchlistItemId: "item_1",
      conditionType: "DRAWDOWN_REACH",
      threshold: "0.12",
      windowDays: 30,
      severity: "IMPORTANT",
    },
    {
      watchlistItemId: "item_1",
      conditionType: "DAILY_MOVE_REACH",
      threshold: "0.05",
      severity: "ATTENTION",
    },
    {
      watchlistItemId: "item_1",
      conditionType: "POSITION_WEIGHT_ABOVE",
      threshold: "0.20",
      severity: "URGENT",
    },
    {
      watchlistItemId: "item_1",
      conditionType: "UNREALIZED_GAIN_REACH",
      threshold: "0.30",
      severity: "INFORMATION",
    },
    {
      watchlistItemId: "item_1",
      conditionType: "REVIEW_DATE",
      thresholdDate: "2026-08-15",
      severity: "ATTENTION",
    },
  ])("creates the $conditionType rule with its structured payload", async (input) => {
    vi.mocked(apiPost).mockResolvedValue({ id: `condition_${input.conditionType}` });

    await createObservationCondition(input);

    expect(apiPost).toHaveBeenCalledWith(
      "/api/v1/observation-conditions",
      input,
    );
  });

  it("updates and deletes a rule using its optimistic version", async () => {
    const condition = {
      id: "condition_1",
      watchlistItemId: "item_1",
      instrumentId: "600519.SH",
      conditionType: "DRAWDOWN_REACH" as const,
      threshold: "0.12",
      thresholdDate: null,
      windowDays: 20,
      severity: "ATTENTION" as const,
      status: "ACTIVE" as const,
      lastObserved: null,
      lastEvaluatedAt: null,
      lastTriggeredAt: null,
      version: 4,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };
    vi.mocked(apiPatch).mockResolvedValue({
      ...condition,
      status: "PAUSED",
      version: 5,
    });

    await updateObservationCondition(condition, {
      threshold: "0.15",
      windowDays: 40,
      severity: "URGENT",
      status: "PAUSED",
    });
    await deleteObservationCondition(condition);

    expect(apiPatch).toHaveBeenCalledWith(
      "/api/v1/observation-conditions/condition_1",
      {
        threshold: "0.15",
        windowDays: 40,
        severity: "URGENT",
        status: "PAUSED",
      },
      4,
    );
    expect(apiDelete).toHaveBeenCalledWith(
      "/api/v1/observation-conditions/condition_1",
      undefined,
      4,
    );
  });

  it("evaluates the requested rules and preserves insufficient data", async () => {
    vi.mocked(apiPost).mockResolvedValue({
      items: [{
        conditionId: "condition_1",
        status: "insufficient_data",
        triggered: false,
        observedValue: null,
        dataAsOf: null,
      }],
    });

    const result = await evaluateObservationConditions(
      ["condition_1"],
      "watchlist-manual",
    );

    expect(apiPost).toHaveBeenCalledWith(
      "/api/v1/observation-conditions/evaluate",
      {
        conditionIds: ["condition_1"],
        reason: "watchlist-manual",
      },
    );
    expect(result[0]?.status).toBe("insufficient_data");
  });
});
