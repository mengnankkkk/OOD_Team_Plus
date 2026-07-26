import Decimal from "decimal.js";

import { createId, getDatabase, isoNow } from "@/server/http/context";

import type { ObservationConditionType } from "./condition-contract";
import { readObservedMetric, shanghaiDate, type ConditionRow, type ObservedMetric } from "./condition-metrics";
import { insertNotification, type NotificationSeverity } from "./notification-writer";

export type { ObservationConditionType } from "./condition-contract";

type Evaluation = {
  conditionId: string;
  status: "evaluated" | "insufficient_data" | "failed";
  triggered: boolean;
  observedValue: string | null;
  dataAsOf: string | null;
  eventId?: string;
  duplicate?: boolean;
  notificationCreated?: boolean;
  errorCode?: string;
  errorMessage?: string;
};

export async function evaluateWatchConditions(conditionIds: string[], reason: string, userId?: string): Promise<void> {
  evaluateConditions(conditionIds, reason, userId);
}

export function evaluateConditions(
  conditionIds: string[] | undefined,
  reason: string,
  userId?: string,
): Evaluation[] {
  const db = getDatabase();
  try {
    const conditions = loadConditions(db, conditionIds, userId);
    const evaluatedAt = isoNow();
    return conditions.map((condition) => {
      try {
        return evaluateOne(db, condition, reason, evaluatedAt);
      } catch {
        return {
          ...result(condition.id, "failed", false, null, null),
          notificationCreated: false,
          errorCode: "CONDITION_EVALUATION_FAILED",
          errorMessage: "观察规则评估失败。",
        };
      }
    });
  } finally {
    db.close();
  }
}

export function hasConditionCrossed(
  type: ObservationConditionType,
  previous: string | null,
  current: string,
  threshold: string,
): boolean {
  const prior = previous == null ? null : decimal(previous);
  const value = decimal(current);
  const target = decimal(threshold);
  if (prior === null) return false;
  if (type === "PRICE_BELOW") return prior.gt(target) && value.lte(target);
  if (type === "REVIEW_DATE" || type === "DAILY_MOVE_REACH") return false;
  return prior.lt(target) && value.gte(target);
}

export function dailyMoveEvaluationKey(conditionId: string, tradingDate: string): string {
  return `${conditionId}:DAILY_MOVE_REACH:${tradingDate}`;
}

export function reviewDateEvaluationKey(conditionId: string, thresholdDate: string): string {
  return `${conditionId}:REVIEW_DATE:${thresholdDate}`;
}

function evaluateOne(
  db: ReturnType<typeof getDatabase>,
  condition: ConditionRow,
  reason: string,
  evaluatedAt: string,
): Evaluation {
  const observed = readObservedMetric(db, condition);
  if (observed.value === null) {
    updateObservation(db, condition.id, null, observed.dataAsOf, evaluatedAt, false);
    return result(condition.id, "insufficient_data", false, null, observed.dataAsOf);
  }

  const observedText = clean(observed.value);
  const triggered = isTriggered(condition, observed, observedText);
  if (!triggered) {
    updateObservation(db, condition.id, observedText, observed.dataAsOf, evaluatedAt, false);
    return result(condition.id, "evaluated", false, observedText, observed.dataAsOf);
  }

  const evaluationKey = evaluationKeyFor(condition, observed, observedText);
  const eventId = createId("watch_event");
  let outcome: Evaluation | undefined;
  db.transaction(() => {
    const inserted = db.prepare(`INSERT INTO observation_condition_events
      (id,condition_id,user_id,observed_value,threshold_decimal,evaluation_key,triggered_at,reason)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(evaluation_key) DO NOTHING`)
      .run(
        eventId,
        condition.id,
        condition.user_id,
        observedText,
        condition.threshold_decimal,
        evaluationKey,
        evaluatedAt,
        reason,
      );
    if (!inserted.changes) {
      updateObservation(db, condition.id, observedText, observed.dataAsOf, evaluatedAt, false);
      outcome = {
        ...result(condition.id, "evaluated", false, observedText, observed.dataAsOf),
        duplicate: true,
        notificationCreated: false,
      };
      return;
    }

    const notificationCreated = writeConditionNotification(db, condition, observed, observedText, eventId);
    updateObservation(db, condition.id, observedText, observed.dataAsOf, evaluatedAt, true);
    outcome = {
      ...result(condition.id, "evaluated", true, observedText, observed.dataAsOf),
      eventId,
      notificationCreated,
    };
  })();
  if (!outcome) throw new Error("Condition evaluation did not produce an outcome");
  return outcome;
}

function isTriggered(condition: ConditionRow, observed: ObservedMetric, observedText: string): boolean {
  if (condition.condition_type === "REVIEW_DATE") {
    const thresholdDate = String(condition.threshold_date ?? "");
    return Boolean(thresholdDate) && shanghaiDate() >= thresholdDate;
  }
  if (condition.condition_type === "DAILY_MOVE_REACH") {
    return observed.value!.gte(decimal(condition.threshold_decimal));
  }
  const previous = condition.last_observed_decimal == null ? null : String(condition.last_observed_decimal);
  return hasConditionCrossed(
    condition.condition_type,
    previous,
    observedText,
    String(condition.threshold_decimal),
  );
}

function evaluationKeyFor(condition: ConditionRow, observed: ObservedMetric, observedText: string): string {
  if (condition.condition_type === "DAILY_MOVE_REACH") {
    const tradingDate = String(observed.metricSnapshot.tradingDate ?? observed.dataAsOf ?? "")
      .replace(/\D/gu, "")
      .slice(0, 8);
    return dailyMoveEvaluationKey(condition.id, tradingDate);
  }
  if (condition.condition_type === "REVIEW_DATE") {
    return reviewDateEvaluationKey(condition.id, String(condition.threshold_date));
  }
  return `${condition.id}:${condition.condition_type}:${observed.evaluationSourceKey ?? observed.dataAsOf ?? observedText}`;
}

function writeConditionNotification(
  db: ReturnType<typeof getDatabase>,
  condition: ConditionRow,
  observed: ObservedMetric,
  observedText: string,
  eventId: string,
): boolean {
  const context = readNotificationContext(db, condition);
  const label = conditionLabel(condition.condition_type);
  const threshold = condition.condition_type === "REVIEW_DATE"
    ? String(condition.threshold_date)
    : String(condition.threshold_decimal);
  const dataAsOf = observed.dataAsOf ?? isoNow();
  return insertNotification(db, {
    userId: condition.user_id,
    severity: String(condition.severity ?? "attention") as NotificationSeverity,
    title: `${context.name ?? context.symbol ?? "观察标的"}${label}`,
    body: `规则“${label}”已触发。当前值 ${observedText}，阈值 ${threshold}。`,
    sourceType: "WATCH_CONDITION",
    sourceId: condition.id,
    groupKey: `${condition.watchlist_item_id ?? condition.instrument_id ?? condition.id}:${condition.condition_type}`,
    dedupeKey: `condition-event:${eventId}`,
    dataAsOf,
    conditionId: condition.id,
    eventId,
    metadata: {
      ...context,
      conditionId: condition.id,
      rule: condition.condition_type,
      metricValue: observed.value?.toNumber() ?? null,
      threshold,
      dataAsOf,
      metricSnapshot: observed.metricSnapshot,
      advisorPrompt: `请结合我的持仓、目标和关注理由，分析“${label}”触发后的证据、风险与可模拟方案，不要直接替我下单。`,
    },
  }) > 0;
}

function readNotificationContext(db: ReturnType<typeof getDatabase>, condition: ConditionRow): Record<string, unknown> {
  if (!condition.watchlist_item_id) return { instrumentId: condition.instrument_id };
  const row = db.prepare(`SELECT wi.watchlist_id,wi.id AS watchlist_item_id,wi.instrument_id,wi.goal_id,wi.reason,
      i.symbol,i.name FROM watchlist_items wi JOIN instruments i ON i.id=wi.instrument_id WHERE wi.id=?`)
    .get(condition.watchlist_item_id) as Record<string, unknown> | undefined;
  return row ? {
    watchlistId: row.watchlist_id,
    watchlistItemId: row.watchlist_item_id,
    instrumentId: row.instrument_id,
    goalId: row.goal_id,
    reason: row.reason,
    symbol: row.symbol,
    name: row.name,
  } : { instrumentId: condition.instrument_id };
}

function updateObservation(
  db: ReturnType<typeof getDatabase>,
  id: string,
  observedValue: string | null,
  dataAsOf: string | null,
  now: string,
  triggered: boolean,
): void {
  db.prepare(`UPDATE observation_conditions SET last_observed_decimal=?,last_evaluated_at=?,
    last_triggered_at=CASE WHEN ? THEN ? ELSE last_triggered_at END,updated_at=? WHERE id=?`)
    .run(observedValue, now, triggered ? 1 : 0, now, now, id);
}

function loadConditions(
  db: ReturnType<typeof getDatabase>,
  conditionIds: string[] | undefined,
  userId?: string,
): ConditionRow[] {
  const ownerClause = userId ? " AND user_id = ?" : "";
  const ownerParams = userId ? [userId] : [];
  return (conditionIds?.length
    ? db.prepare(`SELECT * FROM observation_conditions WHERE id IN (${conditionIds.map(() => "?").join(",")})
      AND status='active'${ownerClause}`).all(...conditionIds, ...ownerParams)
    : db.prepare(`SELECT * FROM observation_conditions WHERE status='active'${ownerClause}`).all(...ownerParams)
  ) as ConditionRow[];
}

function result(
  conditionId: string,
  status: Evaluation["status"],
  triggered: boolean,
  observedValue: string | null,
  dataAsOf: string | null,
): Evaluation {
  return { conditionId, status, triggered, observedValue, dataAsOf };
}

function conditionLabel(type: ObservationConditionType): string {
  return ({
    PRICE_ABOVE: "价格上穿阈值",
    PRICE_BELOW: "价格下穿阈值",
    DRAWDOWN_REACH: "回撤达到阈值",
    DAILY_MOVE_REACH: "单日异动达到阈值",
    POSITION_WEIGHT_ABOVE: "持仓权重达到阈值",
    UNREALIZED_GAIN_REACH: "浮盈达到阈值",
    REVIEW_DATE: "到达复查日期",
  })[type];
}

function decimal(value: unknown): Decimal { return new Decimal(String(value ?? 0)); }

function clean(value: Decimal): string { return value.toDecimalPlaces(8).toString(); }
