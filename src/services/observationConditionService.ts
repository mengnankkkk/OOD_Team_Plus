import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
} from "@/features/frontend-migration/api";

export const OBSERVATION_CONDITION_TYPES = [
  "PRICE_ABOVE",
  "PRICE_BELOW",
  "DRAWDOWN_REACH",
  "DAILY_MOVE_REACH",
  "POSITION_WEIGHT_ABOVE",
  "UNREALIZED_GAIN_REACH",
  "REVIEW_DATE",
] as const;

export type ObservationConditionType =
  (typeof OBSERVATION_CONDITION_TYPES)[number];
export type ObservationConditionSeverity =
  | "INFORMATION"
  | "ATTENTION"
  | "IMPORTANT"
  | "URGENT";
export type ObservationConditionStatus = "ACTIVE" | "PAUSED";
export type ObservationConditionListStatus =
  | "active"
  | "paused"
  | "deleted";

export type ObservationCondition = {
  id: string;
  watchlistItemId: string | null;
  instrumentId: string | null;
  conditionType: ObservationConditionType;
  threshold: string;
  thresholdDate: string | null;
  windowDays: number | null;
  severity: ObservationConditionSeverity;
  status: ObservationConditionStatus;
  lastObserved: string | null;
  lastEvaluatedAt: string | null;
  lastTriggeredAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type ThresholdConditionCreateInput = {
  watchlistItemId: string;
  conditionType: Exclude<
    ObservationConditionType,
    "DRAWDOWN_REACH" | "REVIEW_DATE"
  >;
  threshold: string;
  thresholdDate?: never;
  windowDays?: never;
  severity: ObservationConditionSeverity;
};

type DrawdownConditionCreateInput = {
  watchlistItemId: string;
  conditionType: "DRAWDOWN_REACH";
  threshold: string;
  thresholdDate?: never;
  windowDays?: number;
  severity: ObservationConditionSeverity;
};

type ReviewDateConditionCreateInput = {
  watchlistItemId: string;
  conditionType: "REVIEW_DATE";
  threshold?: never;
  thresholdDate: string;
  windowDays?: never;
  severity: ObservationConditionSeverity;
};

export type ObservationConditionCreateInput =
  | ThresholdConditionCreateInput
  | DrawdownConditionCreateInput
  | ReviewDateConditionCreateInput;

export type ObservationConditionPatch = {
  threshold?: string;
  thresholdDate?: string | null;
  windowDays?: number | null;
  severity?: ObservationConditionSeverity;
  status?: ObservationConditionStatus;
};

export type ObservationConditionEvaluation = {
  conditionId: string;
  status: "evaluated" | "insufficient_data";
  triggered: boolean;
  observedValue: string | null;
  dataAsOf: string | null;
  eventId?: string;
  duplicate?: boolean;
};

export async function listObservationConditions(
  watchlistItemId: string,
  status?: ObservationConditionListStatus,
): Promise<ObservationCondition[]> {
  const params = new URLSearchParams({
    watchlistItemId,
    limit: "100",
  });
  if (status) params.set("status", status);
  const result = await apiGet<{ items: ObservationCondition[] }>(
    `/api/v1/observation-conditions?${params.toString()}`,
  );
  return result.items;
}

export function createObservationCondition(
  input: ObservationConditionCreateInput,
): Promise<ObservationCondition> {
  return apiPost<ObservationCondition>(
    "/api/v1/observation-conditions",
    input,
  );
}

export function updateObservationCondition(
  condition: ObservationCondition,
  patch: ObservationConditionPatch,
): Promise<ObservationCondition> {
  return apiPatch<ObservationCondition>(
    `/api/v1/observation-conditions/${encodeURIComponent(condition.id)}`,
    patch,
    condition.version,
  );
}

export async function deleteObservationCondition(
  condition: ObservationCondition,
): Promise<void> {
  await apiDelete(
    `/api/v1/observation-conditions/${encodeURIComponent(condition.id)}`,
    undefined,
    condition.version,
  );
}

export async function evaluateObservationConditions(
  conditionIds?: string[],
  reason?: string,
): Promise<ObservationConditionEvaluation[]> {
  const body: { conditionIds?: string[]; reason?: string } = {};
  if (conditionIds) body.conditionIds = conditionIds;
  if (reason) body.reason = reason;
  const result = await apiPost<{ items: ObservationConditionEvaluation[] }>(
    "/api/v1/observation-conditions/evaluate",
    body,
  );
  return result.items;
}
